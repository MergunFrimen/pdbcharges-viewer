import { Sequence } from "molstar/lib/mol-plugin-ui/sequence/sequence";
import { SequenceWrapper } from "molstar/lib/mol-plugin-ui/sequence/wrapper";
import { UUID } from "molstar/lib/mol-util";

type PdbChargesSequenceProps = {
  sequenceWrapper: SequenceWrapper.Any;
  sequenceNumberPeriod?: number;
  hideSequenceNumbers?: boolean;
  warnings: Set<number>;
};

export class PdbChargesSequence extends Sequence<PdbChargesSequenceProps> {
  colors = {
    warning: "rgb(255, 0, 0)",
    highlighted: "rgb(255, 102, 153)",
    selected: "rgb(51, 255, 25)",
  };

  protected updateMarker() {
    if (!this.parentDiv.current) return;
    const xs = this.parentDiv.current.querySelectorAll(
      ".msp-sequence-missing, .msp-sequence-present"
    );
    const { markerArray } = this.props.sequenceWrapper;

    for (let i = 0, il = markerArray.length; i < il; i++) {
      const span = xs[i] as HTMLSpanElement | undefined;
      if (!span) continue;

      const backgroundColor = this.getColor(markerArray[i], i);
      if (span.style.backgroundColor !== backgroundColor)
        span.style.backgroundColor = backgroundColor;
      if (backgroundColor === this.colors.warning) {
        span.style.color = "white";
      }
    }
  }

  private getColor(marker: number, seqIdx?: number) {
    if (seqIdx !== undefined && this.props.warnings.has(seqIdx)) {
      return this.colors.warning;
    }
    if (marker === 0) {
      return "";
    } else if (marker % 2 === 0) {
      return this.colors.selected;
    } else {
      return this.colors.highlighted;
    }
  }

  render() {
    const sw = this.props.sequenceWrapper;

    const elems: JSX.Element[] = [];

    if (this.props.warnings.size > 0) {
      elems[elems.length] = (
        <div
          key={UUID.createv4()}
          style={{
            display: "flex",
            columnGap: "10px",
          }}
        >
          <svg width="12" height="12">
            <rect
              width="12"
              height="12"
              style={{ fill: this.colors.warning }}
            />
          </svg>
          <span style={{ cursor: "default" }}>Warning</span>
        </div>
      );
    }

    const hasNumbers = !this.props.hideSequenceNumbers,
      period = this.sequenceNumberPeriod;
    for (let i = 0, il = sw.length; i < il; ++i) {
      const label = sw.residueLabel(i);
      // add sequence number before name so the html element do not get separated by a line-break
      if (hasNumbers && i % period === 0 && i < il) {
        elems[elems.length] = this.getSequenceNumberSpan(i, label);
      }
      elems[elems.length] = this.residue(i, label, sw.markerArray[i]);
    }

    // calling .updateMarker here is neccesary to ensure existing
    // residue spans are updated as react won't update them
    setTimeout(() => this.updateMarker(), 500);

    return (
      <div
        className="msp-sequence-wrapper"
        onContextMenu={this.contextMenu}
        onMouseDown={this.mouseDown}
        onMouseUp={this.mouseUp}
        onMouseMove={this.mouseMove}
        onMouseLeave={this.mouseLeave}
        ref={this.parentDiv}
      >
        {elems}
      </div>
    );
  }
}
