import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from trajectory_store import TrajectoryStore
from phoenix_trajectory import export_phoenix
try:
    from opentelemetry.sdk.trace.export import SpanExportResult
    SDK = True
except ImportError:
    SDK = False


@unittest.skipUnless(SDK, 'install requirements-telemetry.txt')
class PhoenixExportTests(unittest.TestCase):
    def test_failed_exports_remain_pending_and_sampling_cannot_drop_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            store = TrajectoryStore(Path(directory)/'trace.db')
            store.record({'event_id':'one','episode_id':'ep','step':1,'observation':{'text':'关掉'},
                          'raw_action':{'value':False},'action':{'value':False},'state_before':{'power':True},'state_after':{'power':False},
                          'provenance':{'runtime':'test_fixture'},'execution':{'kind':'simulation'}})
            target='opentelemetry.exporter.otlp.proto.http.trace_exporter.OTLPSpanExporter.export'
            try:
                with patch.dict(os.environ, {'OTEL_TRACES_SAMPLER':'always_off'}), patch(target, return_value=SpanExportResult.FAILURE):
                    with self.assertRaises(RuntimeError): export_phoenix(store)
                self.assertIsNone(store.db.execute('SELECT exported_at FROM turns').fetchone()[0])
                captured=[]
                def accept(spans):
                    captured.extend(spans);return SpanExportResult.SUCCESS
                with patch.dict(os.environ, {'OTEL_TRACES_SAMPLER':'always_off'}), patch(target, side_effect=accept):
                    self.assertEqual(export_phoenix(store),1)
                    self.assertEqual(export_phoenix(store),0)
                self.assertEqual(len(captured),1)
                self.assertEqual(captured[0].name,'flythink.turn')
                self.assertTrue(store.db.execute('SELECT trace_id FROM turns').fetchone()[0])
                with self.assertRaises(ValueError):export_phoenix(store,'https://collector.example/v1/traces')
            finally:store.close()


if __name__=='__main__':unittest.main()
