import merge from "lodash.merge";
import { MAQualityAssessment } from "molstar/lib/extensions/model-archive/quality-assessment/behavior";
import { PLDDTConfidenceColorThemeProvider } from "molstar/lib/extensions/model-archive/quality-assessment/color/plddt";
import {
  SbNcbrPartialCharges,
  SbNcbrPartialChargesPropertyProvider,
} from "molstar/lib/extensions/sb-ncbr";
import { SbNcbrPartialChargesColorThemeProvider } from "molstar/lib/extensions/sb-ncbr/partial-charges/color";
import { MmcifFormat } from "molstar/lib/mol-model-formats/structure/mmcif";
import { Model, StructureSelection } from "molstar/lib/mol-model/structure";
import { PluginUIContext } from "molstar/lib/mol-plugin-ui/context";
import "molstar/lib/mol-plugin-ui/skin/light.scss";
import {
  DefaultPluginUISpec,
  PluginUISpec,
} from "molstar/lib/mol-plugin-ui/spec";
import { StructureFocusRepresentation } from "molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { PluginSpec } from "molstar/lib/mol-plugin/spec";
import { BallAndStickRepresentationProvider } from "molstar/lib/mol-repr/structure/representation/ball-and-stick";
import { GaussianSurfaceRepresentationProvider } from "molstar/lib/mol-repr/structure/representation/gaussian-surface";
import { Script } from "molstar/lib/mol-script/script";
import { ElementSymbolColorThemeProvider } from "molstar/lib/mol-theme/color/element-symbol";
import { PhysicalSizeThemeProvider } from "molstar/lib/mol-theme/size/physical";
import { BehaviorSubject, Observable, Subscription } from "rxjs";
import {
  AsyncResult,
  AtomKey,
  Color,
  Representation3D,
  Size,
  Type,
} from "./types";
import { Color as MolstarColor } from "molstar/lib/mol-util/color";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";

export class ContextModel {
  private _plugin: PluginUIContext;
  private _subscriptions: Subscription[] = [];

  public state = {
    isInitialized: new BehaviorSubject<boolean>(false),
    loadingStatus: new BehaviorSubject<AsyncResult>({ kind: "idle" }),
    showControls: new BehaviorSubject<boolean>(false),
    isExpanded: new BehaviorSubject<boolean>(false),

    warnings: new BehaviorSubject<Set<number> | undefined>(undefined),
  };

  get plugin(): PluginUIContext {
    return this._plugin;
  }

  constructor() {
    const defaultSpec = DefaultPluginUISpec();
    const spec: PluginUISpec = {
      ...defaultSpec,
      behaviors: [
        ...defaultSpec.behaviors,
        PluginSpec.Behavior(MAQualityAssessment),
        PluginSpec.Behavior(SbNcbrPartialCharges),
      ],
      layout: {
        ...defaultSpec.layout,
        initial: {
          isExpanded: this.state.isExpanded.value,
          showControls: this.state.showControls.value,
        },
      },
      canvas3d: {
        ...defaultSpec.canvas3d,
        renderer: {
          backgroundColor: MolstarColor(0xffffff),
        },
      },
      components: {
        ...defaultSpec.components,
        remoteState: "none",
      },
      config: [
        ...(defaultSpec.config ?? []),
        [PluginConfig.Viewport.ShowAnimation, false],
      ],
    };

    this._plugin = new PluginUIContext(spec);
  }

  private _subscribe<T>(observable: Observable<T>, sub: (v: T) => void) {
    this._subscriptions.push(observable.subscribe(sub));
  }

  sub() {
    // sync UI layout controls
    this._subscribe(this.plugin!.layout.events.updated, () => {
      this.state.showControls.next(this.plugin.layout.state.showControls);
      this.state.isExpanded.next(this.plugin.layout.state.isExpanded);
    });
  }

  unsub() {
    for (const sub of this._subscriptions) {
      sub.unsubscribe();
    }
    this._subscriptions = [];
  }

  async init() {
    if (this.state.isInitialized.value) return;

    await this._plugin.init();

    this._plugin.managers.interactivity.setProps({
      granularity: "element",
    });
    this._plugin.behaviors.layout.leftPanelTabName.next("data");

    this.state.isInitialized.next(true);
  }

  async load(url: string) {
    this.state.loadingStatus.next({ kind: "loading" });

    await this.plugin.clear();

    const data = await this.plugin.builders.data.download(
      { url },
      { state: { isGhost: true } }
    );
    const trajectory = await this.plugin.builders.structure.parseTrajectory(
      data,
      "mmcif"
    );
    await this.plugin.builders.structure.hierarchy.applyPreset(
      trajectory,
      "default",
      {
        showUnitcell: false,
        representationPreset: "auto",
        representationPresetParams: {
          theme: {
            globalName: this.elementSymbolColorProps.name,
            carbonColor: "chain-id",
          },
        },
      }
    );

    await this.setInitialRepresentationState();

    this.sanityCheck();

    this.state.loadingStatus.next({ kind: "idle" });
  }

  charges = {
    getMethodNames: () => {
      const model = this.getModel();
      if (!model) throw new Error("No model found");
      const data = SbNcbrPartialChargesPropertyProvider.get(model).value;
      if (!data) throw new Error("No data found");
      const methodNames = [];
      for (let typeId = 1; typeId < data.typeIdToMethod.size + 1; ++typeId) {
        if (!data.typeIdToMethod.has(typeId))
          throw new Error(`Missing method for typeId ${typeId}`);
        methodNames.push(data.typeIdToMethod.get(typeId));
      }
      return methodNames;
    },
    getTypeId: () => {
      const model = this.getModel();
      if (!model) throw new Error("No model loaded.");
      const typeId = SbNcbrPartialChargesPropertyProvider.props(model).typeId;
      if (!typeId) throw new Error("No type id found.");
      return typeId;
    },
    setTypeId: (typeId: number) => {
      const model = this.getModel();
      if (!model) throw new Error("No model loaded.");
      if (!this.isTypeIdValid(model, typeId))
        throw new Error(`Invalid type id ${typeId}`);
      SbNcbrPartialChargesPropertyProvider.set(model, { typeId });
    },
    getMaxCharge: () => {
      const model = this.getModel();
      if (!model) throw new Error("No model loaded.");
      const maxCharge =
        SbNcbrPartialChargesPropertyProvider.get(model).value
          ?.maxAbsoluteAtomChargeAll;
      if (maxCharge === undefined)
        throw new Error("No max charge found for all charge sets.");
      return maxCharge;
    },
  };

  color = {
    default: async (carbonColor: "chain-id" | "uniform") => {
      await this.updateColor("default", {
        carbonColor: {
          name: carbonColor,
          params: {},
        },
      });
    },
    alphaFold: async () => {
      await this.updateColor(PLDDTConfidenceColorThemeProvider.name);
    },
    absolute: async (max: number) => {
      await this.updateColor(this.partialChargesColorProps.name, {
        maxAbsoluteCharge: max,
        absolute: true,
      });
    },
    relative: async () => {
      await this.updateColor(this.partialChargesColorProps.name, {
        absolute: false,
      });
    },
  };

  type = {
    isDefaultApplicable: () => {
      const other = ["cartoon", "carbohydrate"];
      return Array.from(this.defaultProps.values()).some(({ type }) =>
        other.includes(type.name)
      );
    },
    hasWater: () => this.hasWater(),
    default: async () => {
      await this.updateType("default");
    },
    ballAndStick: async () => {
      await this.updateType(this.ballAndStickTypeProps.type.name);
    },
    surface: async () => {
      await this.updateType(this.surfaceTypeProps.type.name);
    },
    setWaterVisibility: (visible: boolean) => {
      this.hideWater(visible);
    },
  };
  behavior = {
    focus: (key: AtomKey) => {
      const data =
        this.plugin.managers.structure.hierarchy.current.structures[0]
          .components[0].cell.obj?.data;
      if (!data) return;

      const { labelCompId, labelSeqId, labelAtomId } = key;

      const selection = Script.getStructureSelection(
        (Q) =>
          Q.struct.generator.atomGroups({
            "atom-test": Q.core.logic.and([
              Q.core.rel.eq([
                Q.struct.atomProperty.macromolecular.label_comp_id(),
                labelCompId,
              ]),
              Q.core.rel.eq([
                Q.struct.atomProperty.macromolecular.label_seq_id(),
                labelSeqId,
              ]),
              Q.core.rel.eq([
                Q.struct.atomProperty.macromolecular.label_atom_id(),
                labelAtomId,
              ]),
            ]),
          }),
        data
      );

      const loci = StructureSelection.toLociWithSourceUnits(selection);
      this.plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
      this.plugin.managers.interactivity.lociSelects.selectOnly({ loci });
      this.plugin.managers.camera.focusLoci(loci);
      this.plugin.managers.structure.focus.setFromLoci(loci);
    },
    focusRange: (range: { residueStart: number; residueEnd: number }) => {
      const data =
        this.plugin.managers.structure.hierarchy.current.structures[0]
          .components[0].cell.obj?.data;
      if (!data) return;

      const { residueStart, residueEnd } = range;

      const selection = Script.getStructureSelection(
        (Q) =>
          Q.struct.generator.atomGroups({
            "residue-test": Q.core.rel.inRange([
              Q.struct.atomProperty.macromolecular.label_seq_id(),
              residueStart,
              residueEnd,
            ]),
          }),
        data
      );

      const loci = StructureSelection.toLociWithSourceUnits(selection);
      // this.plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
      this.plugin.managers.interactivity.lociSelects.selectOnly({ loci });
      this.plugin.managers.camera.focusLoci(loci);
      // this.plugin.managers.structure.focus.setFromLoci(loci);
    },
  };

  private readonly defaultProps: Map<string, Representation3D> = new Map();

  private readonly ballAndStickTypeProps: {
    type: Type;
    sizeTheme: Size;
  } = {
    type: {
      name: BallAndStickRepresentationProvider.name,
      params: {
        ...BallAndStickRepresentationProvider.defaultValues,
      },
    },
    sizeTheme: {
      name: PhysicalSizeThemeProvider.name,
      params: {
        ...PhysicalSizeThemeProvider.defaultValues,
      },
    },
  };
  private readonly surfaceTypeProps: {
    type: Type;
    sizeTheme: Size;
  } = {
    type: {
      name: GaussianSurfaceRepresentationProvider.name,
      params: {
        ...GaussianSurfaceRepresentationProvider.defaultValues,
        smoothColors: {
          name: "on",
          params: {
            resolutionFactor: 2,
            sampleStride: 3,
          },
        },
      },
    },
    sizeTheme: {
      name: PhysicalSizeThemeProvider.name,
      params: {
        ...PhysicalSizeThemeProvider.defaultValues,
        scale: 1,
      },
    },
  };
  private readonly partialChargesColorProps: Color = {
    name: SbNcbrPartialChargesColorThemeProvider.name,
    params: {
      // not using default values
    },
  };
  private readonly elementSymbolColorProps: Color = {
    name: ElementSymbolColorThemeProvider.name,
    params: {
      ...ElementSymbolColorThemeProvider.defaultValues,
    },
  };
  private readonly plddtColorProps: Color = {
    name: PLDDTConfidenceColorThemeProvider.name,
    params: {
      ...PLDDTConfidenceColorThemeProvider.defaultValues,
    },
  };
  private readonly physicalSizeProps: Size = {
    name: PhysicalSizeThemeProvider.name,
    params: {
      ...PhysicalSizeThemeProvider.defaultValues,
    },
  };

  private async setInitialRepresentationState() {
    this.defaultProps.clear();
    await this.plugin.dataTransaction(() => {
      for (const structure of this.plugin.managers.structure.hierarchy.current
        .structures) {
        for (const component of structure.components) {
          for (const representation of component.representations) {
            const params = representation.cell.transform.params;
            if (!params) continue;
            const { type } = params;
            this.defaultProps.set(representation.cell.transform.ref, {
              type: type as Type,
              colorTheme: this.elementSymbolColorProps,
              sizeTheme: this.physicalSizeProps,
            });
          }
        }
      }
    });
  }

  private async updateType(name: Type["name"]) {
    this.state.loadingStatus.next({ kind: "loading" });

    await this.plugin.dataTransaction(async () => {
      for (const structure of this.plugin.managers.structure.hierarchy.current
        .structures) {
        const update = this.plugin.state.data.build();
        for (const component of structure.components) {
          for (const representation of component.representations) {
            let type, sizeTheme;

            if (!this.defaultProps.has(representation.cell.transform.ref))
              continue;

            if (name === this.ballAndStickTypeProps.type.name) {
              type = this.ballAndStickTypeProps.type;
              sizeTheme = this.ballAndStickTypeProps.sizeTheme;
            } else if (name === this.surfaceTypeProps.type.name) {
              type = this.surfaceTypeProps.type;
              sizeTheme = this.surfaceTypeProps.sizeTheme;
            } else if (name == "default") {
              type = this.defaultProps.get(
                representation.cell.transform.ref
              )?.type;
              sizeTheme = this.defaultProps.get(
                representation.cell.transform.ref
              )?.sizeTheme;
            } else {
              throw new Error("Invalid type theme");
            }

            const oldProps = representation.cell.transform.params;

            // switches to residue charge for certain representations
            const showResidueChargeFor = ["cartoon", "carbohydrate"];
            const typeName = type?.name;
            const showResidueCharge =
              typeName && showResidueChargeFor.includes(typeName);
            let colorTheme = oldProps?.colorTheme;
            colorTheme = merge({}, colorTheme, {
              params: { chargeType: showResidueCharge ? "residue" : "atom" },
            });

            const mergedProps = merge({}, oldProps, {
              type,
              sizeTheme,
              colorTheme,
            });
            update.to(representation.cell).update(mergedProps);
          }
        }
        await update.commit({ canUndo: "Update Theme" });
      }
      this.updateGranularity(name);
    });

    this.state.loadingStatus.next({ kind: "idle" });
  }

  private async updateColor(name: Color["name"], params: Color["params"] = {}) {
    this.state.loadingStatus.next({ kind: "loading" });

    await this.plugin.dataTransaction(async () => {
      for (const structure of this.plugin.managers.structure.hierarchy.current
        .structures) {
        const update = this.plugin.state.data.build();
        for (const component of structure.components) {
          for (const representation of component.representations) {
            let colorTheme;

            if (!this.defaultProps.has(representation.cell.transform.ref)) {
              colorTheme = this.elementSymbolColorProps;
            } else if (name === this.partialChargesColorProps.name) {
              colorTheme = this.partialChargesColorProps;
            } else if (name === this.plddtColorProps.name) {
              colorTheme = this.plddtColorProps;
            } else if (name === "default") {
              colorTheme = this.defaultProps.get(
                representation.cell.transform.ref
              )?.colorTheme;
            } else {
              throw new Error("Invalid color theme");
            }

            // switches to residue charge for certain representations
            const showResidueChargeFor = ["cartoon", "carbohydrate"];
            const typeName = representation.cell.transform.params?.type?.name;
            const showResidueCharge =
              typeName && showResidueChargeFor.includes(typeName);
            params = merge({}, params, {
              chargeType: showResidueCharge ? "residue" : "atom",
            });

            const oldProps = representation.cell.transform.params;
            const mergedProps = merge(
              {},
              oldProps,
              { colorTheme },
              { colorTheme: { params } }
            );
            update.to(representation.cell).update(mergedProps);
          }
        }
        await update.commit({ canUndo: "Update Theme" });
      }
      await this.updateFocusColorTheme(name, params);
    });

    this.state.loadingStatus.next({ kind: "idle" });
  }

  private sanityCheck() {
    // if (!this.plugin) throw new Error('No plugin found.');
    // if (!this.plugin.managers.structure.hierarchy.current.structures.length)
    //     throw new Error('No structure loaded.');
    const model = this.getModel();
    if (!model) throw new Error("No model loaded.");
    const sourceData = model.sourceData as MmcifFormat;
    const atomCount = model.atomicHierarchy.atoms._rowCount;
    const chargesCount =
      sourceData.data.frame.categories.sb_ncbr_partial_atomic_charges.rowCount;
    if (chargesCount > 0 && chargesCount % atomCount !== 0)
      throw new Error(
        `Atom count (${atomCount}) does not match charge count (${chargesCount}).`
      );
  }

  private updateGranularity(type: Type["name"]) {
    this.plugin.managers.interactivity.setProps({
      granularity: type === "default" ? "residue" : "element",
    });
  }

  private async updateFocusColorTheme(
    color: Color["name"],
    params: Color["params"] = {}
  ) {
    let props =
      color === SbNcbrPartialChargesColorThemeProvider.name
        ? this.partialChargesColorProps
        : this.elementSymbolColorProps;
    props = merge({}, props, { params: { ...params, chargeType: "atom" } });
    await this.plugin.state.updateBehavior(
      StructureFocusRepresentation,
      (p) => {
        p.targetParams.colorTheme = props;
        p.surroundingsParams.colorTheme = props;
      }
    );
  }

  private getModel() {
    return this.plugin.managers.structure.hierarchy.current.structures[0].model
      ?.cell?.obj?.data;
  }

  private isTypeIdValid(model: Model, typeId: number) {
    const sourceData = model.sourceData as MmcifFormat;
    const typeIds =
      sourceData.data.frame.categories.sb_ncbr_partial_atomic_charges_meta
        .getField("id")
        ?.toIntArray();
    return typeIds?.includes(typeId);
  }

  hideWater(visible: boolean) {
    for (const structure of this.plugin.managers.structure.hierarchy.current
      .structures) {
      for (const component of structure.components) {
        for (const representation of component.representations) {
          const tags = representation.cell.transform.tags;
          if (tags?.includes("water")) {
            setSubtreeVisibility(
              this.plugin.state.data,
              representation.cell.transform.ref,
              !visible
            );
          }
        }
      }
    }
  }

  hasWater() {
    for (const structure of this.plugin.managers.structure.hierarchy.current
      .structures) {
      for (const component of structure.components) {
        for (const representation of component.representations) {
          const tags = representation.cell.transform.tags;
          if (tags?.includes("water")) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
