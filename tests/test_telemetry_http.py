import functools
import json
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import HTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from telemetry_cli import Handler
from trajectory_store import TrajectoryStore


class HTTPTests(unittest.TestCase):
    def test_ingestion_retry_feedback_and_private_file_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory)/'events.sqlite3'
            server = HTTPServer(('127.0.0.1', 0), functools.partial(Handler, database=database))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            e = {'event_id':'fixture-event', 'episode_id':'fixture-episode', 'trajectory_step':1,
                 'text':'关掉','before':{'power':True},'after':{'power':False},'delta':{'power':False},
                 'outcome':'committed','world_deltas':[{'power':False}]}
            def post(path, body, origin=base):
                req=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':origin})
                with urllib.request.urlopen(req) as response:return json.load(response)
            try:
                self.assertEqual(post('/telemetry/turns',{'events':[e]})['inserted'],1)
                self.assertEqual(post('/telemetry/turns',{'events':[e]})['inserted'],0)
                e['feedback']='incorrect';e['correction_candidate']={'text':'是客厅那个','label':'candidate_not_gold'}
                post('/telemetry/turns',{'events':[e]})
                post('/telemetry/finish',{'episode_id':'fixture-episode'})
                with self.assertRaises(urllib.error.HTTPError) as error:post('/telemetry/turns',{'events':[e]},'https://unrelated.example')
                self.assertEqual(error.exception.code,403)
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(base+'/%74elemetry%2fprivate.json')
                self.assertEqual(error.exception.code,404)
                store=TrajectoryStore(database)
                rows=list(store.export());store.close()
                self.assertEqual(len(rows),1);self.assertEqual(len(rows[0]['feedback']),2)
                self.assertTrue(rows[0]['truncated']);self.assertFalse(rows[0]['training_eligible'])
                self.assertEqual(rows[0]['provenance']['runtime'],'browser_rule_runtime')
            finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
