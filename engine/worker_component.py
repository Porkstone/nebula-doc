"""Trusted in-process UNO component; no document-provided code is loaded."""
import importlib.util
import json
import os
import traceback
import unohelper
from com.sun.star.task import XJob

spec = importlib.util.spec_from_file_location('nebula_document_worker', os.path.join(os.path.dirname(__file__), 'worker.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DocumentJob(unohelper.Base, XJob):
    def __init__(self, ctx):
        self.worker = module.Worker(ctx=ctx)

    def execute(self, arguments):
        message = json.loads(next(a.Value for a in arguments if a.Name == 'Request'))
        try:
            result = self.worker.dispatch(message['method'], message.get('params', {}))
            return json.dumps(dict(id=message['id'], result=result,
                                   timings=getattr(self.worker, 'last_timings', None) if message['method'] == 'open' else None))
        except Exception as error:
            traceback.print_exc()
            return json.dumps(dict(id=message['id'], error=str(error)))


g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(DocumentJob, 'org.nebula.doc.DocumentJob', ('com.sun.star.task.Job',))
