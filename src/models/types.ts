import { StructureRepresentationRegistry } from 'molstar/lib/mol-repr/structure/registry';
import { ColorTheme } from 'molstar/lib/mol-theme/color';
import { SizeTheme } from 'molstar/lib/mol-theme/size';

export type Representation3D = {
    colorTheme: Color;
    type: Type;
    sizeTheme: Size;
};

export type Type = {
    name: StructureRepresentationRegistry.BuiltIn | 'default';
    params: StructureRepresentationRegistry.BuiltInParams<StructureRepresentationRegistry.BuiltIn>;
};
export type Color = {
    name: ColorTheme.BuiltIn | 'sb-ncbr-partial-charges' | 'plddt-confidence' | 'default';
    params: ColorTheme.BuiltInParams<ColorTheme.BuiltIn>;
};
export type Size = {
    name: SizeTheme.BuiltIn;
    params: SizeTheme.BuiltInParams<SizeTheme.BuiltIn>;
};

export type AtomKey = {
    labelCompId: string;
    labelSeqId: number;
    labelAtomId: string;
};

export type AsyncResult<E = string> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: E };
