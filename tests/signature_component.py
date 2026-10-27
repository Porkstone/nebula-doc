"""Run the frame/bookmark regression in the production component's process."""
import json
import os
import sys
import traceback
import unohelper

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
sys.path.insert(0, os.path.dirname(__file__))
from worker_component import DocumentJob
from signature_roundtrip import verify


class SignatureRegression(DocumentJob):
    def execute(self, arguments):
        message = json.loads(next(a.Value for a in arguments if a.Name == 'Request'))
        if message['method'] != 'verify':
            return super().execute(arguments)
        try:
            result = verify(self.worker, message['params']['source'], message['params']['output'])
            return json.dumps(dict(id=message['id'], result=result))
        except Exception as error:
            traceback.print_exc()
            return json.dumps(dict(id=message['id'], error=str(error) or traceback.format_exc()))


g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(SignatureRegression, 'org.nebula.doc.SignatureRegression', ('com.sun.star.task.Job',))
