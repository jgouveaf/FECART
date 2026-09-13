"""Prepare browser ONNX face models.

Usage:
  python tools/prepare_web_face_models.py sface ORIGINAL_ONNX OUTPUT_ONNX
  python tools/prepare_web_face_models.py scrfd ORIGINAL_ONNX OUTPUT_ONNX
Requires onnx, but does not install packages, download files or modify weights.
"""
import argparse
import hashlib
from pathlib import Path
import onnx

def prepare_sface(source, destination):
    model = onnx.load(str(source))
    parameters = {item.name for item in model.graph.initializer}
    public_inputs = [item for item in model.graph.input if item.name not in parameters]
    if len(public_inputs) != 1 or public_inputs[0].name != 'data':
        raise ValueError('Expected the original OpenCV SFace graph with input data')
    del model.graph.input[:]
    model.graph.input.extend(public_inputs)
    model.ir_version = max(4, model.ir_version)
    onnx.checker.check_model(model)
    onnx.save(model, str(destination))
    print(hashlib.sha256(Path(destination).read_bytes()).hexdigest())

def prepare_scrfd(source, destination):
    model = onnx.load(str(source))
    for output in model.graph.output:
        shape = output.type.tensor_type.shape
        if len(shape.dim) == 2:
            shape.dim[0].dim_param = f'{output.name}_anchors'
            shape.dim[0].ClearField('dim_value')
    onnx.checker.check_model(model)
    onnx.save(model, str(destination))
    print(hashlib.sha256(Path(destination).read_bytes()).hexdigest())

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=('sface', 'scrfd'))
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.destination.resolve():
        parser.error('Use a separate output to preserve the original model')
    if args.kind == 'sface':
        prepare_sface(args.source, args.destination)
    else:
        prepare_scrfd(args.source, args.destination)
