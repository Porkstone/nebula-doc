import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
from worker import run_bridge

run_bridge(sys.argv[1], os.path.join(os.path.dirname(__file__), 'signature_component.py'), 'org.nebula.doc.SignatureRegression')
