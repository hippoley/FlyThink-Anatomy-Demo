"""Replay durable trajectories as OpenInference spans to self-hosted Phoenix."""
import json
import os
import time
from urllib.parse import urlparse
from trajectory_store import encode


def export_phoenix(store, endpoint='http://127.0.0.1:6006/v1/traces', project='flythink', allow_remote=False):
    host = urlparse(endpoint).hostname
    if host not in ('localhost', '127.0.0.1', '::1') and not allow_remote:
        raise ValueError('remote telemetry requires explicit --allow-remote')
    from opentelemetry import trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.sampling import ALWAYS_ON
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    memory = InMemorySpanExporter()
    provider = TracerProvider(sampler=ALWAYS_ON, resource=Resource.create({'openinference.project.name': project, 'service.name': 'flythink'}))
    provider.add_span_processor(SimpleSpanProcessor(memory))
    tracer = provider.get_tracer('flythink.trajectory', '1.0')
    headers = {'Authorization': 'Bearer ' + os.environ['PHOENIX_API_KEY']} if os.environ.get('PHOENIX_API_KEY') else None
    exporter = OTLPSpanExporter(endpoint=endpoint, headers=headers, timeout=5)
    sent = 0
    try:
        for row in store.db.execute('SELECT * FROM turns WHERE exported_at IS NULL ORDER BY episode,step').fetchall():
            event = json.loads(row['payload'])
            start = event.get('started_ns') or time.time_ns()
            end = max(start, event.get('ended_ns') or start)
            root = tracer.start_span('flythink.turn', start_time=start, attributes={
                'openinference.span.kind': 'CHAIN', 'session.id': row['episode'],
                'input.value': encode(event['observation']), 'input.mime_type': 'application/json',
                'output.value': encode(event['action']), 'output.mime_type': 'application/json',
                'metadata': encode({'event_id': row['id'], 'step': row['step'], 'provenance': event['provenance'], 'execution': event['execution'], 'state_before': event['state_before'], 'state_after': event['state_after'], 'raw_action': event['raw_action']}),
            })
            ctx = trace.set_span_in_context(root)
            for phase in event.get('phases', []):
                child = tracer.start_span('flythink.' + phase['name'], context=ctx, start_time=phase['started_ns'], attributes={
                    'openinference.span.kind': 'CHAIN', 'session.id': row['episode'],
                    'input.value': encode(phase.get('input')), 'output.value': encode(phase.get('output')),
                    'input.mime_type': 'application/json', 'output.mime_type': 'application/json'})
                child.end(end_time=phase['ended_ns'])
            root.end(end_time=end)
            spans = memory.get_finished_spans()
            if len(spans) != 1 + len(event.get('phases', [])):
                raise RuntimeError('Incomplete spans; event remains pending')
            if exporter.export(spans) != SpanExportResult.SUCCESS:
                raise RuntimeError('Phoenix export failed; events remain pending in SQLite')
            context = root.get_span_context()
            with store.db:
                store.db.execute('UPDATE turns SET trace_id=?,span_id=?,exported_at=? WHERE id=?', (format(context.trace_id, '032x'), format(context.span_id, '016x'), time.time_ns(), row['id']))
            memory.clear()
            sent += 1
        for row in store.db.execute('SELECT f.*,t.trace_id,t.span_id,t.episode FROM feedback f JOIN turns t ON t.id=f.turn_id LEFT JOIN feedback_exports x ON x.id=f.id WHERE x.id IS NULL AND t.trace_id IS NOT NULL').fetchall():
            from opentelemetry.trace import SpanContext, TraceFlags, NonRecordingSpan
            parent = SpanContext(int(row['trace_id'], 16), int(row['span_id'], 16), False, TraceFlags(TraceFlags.SAMPLED))
            ctx = trace.set_span_in_context(NonRecordingSpan(parent))
            span = tracer.start_span('flythink.feedback', context=ctx, start_time=row['created_ns'], attributes={
                'openinference.span.kind': 'CHAIN', 'session.id': row['episode'],
                'input.value': row['turn_id'], 'output.value': row['payload'],
                'output.mime_type': 'application/json', 'metadata': encode({'feedback_id': row['id']})})
            span.end(end_time=row['created_ns'])
            if exporter.export(memory.get_finished_spans()) != SpanExportResult.SUCCESS:
                raise RuntimeError('Phoenix feedback export failed; feedback remains pending')
            with store.db:
                store.db.execute('INSERT INTO feedback_exports VALUES(?,?)', (row['id'], time.time_ns()))
            memory.clear()
    finally:
        exporter.shutdown()
        provider.shutdown()
    return sent
