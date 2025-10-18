import { connect, createRoot, disconnect, type Remix } from "@remix-run/dom";
import { events } from "@remix-run/events";
import {
  arrowDown,
  arrowLeft,
  arrowRight,
  arrowUp,
  escape,
  space,
} from "@remix-run/events/key";
import { press } from "@remix-run/events/press";
import { Button, ControlGroup, Layout, TempoButton } from "./components.tsx";
import { Drummer, type Instrument, type NoteState } from "./drummer.ts";
import { tempoTap } from "./tempo-event.ts";

function DrumMachine(this: Remix.Handle<Drummer>) {
  let drummer: Drummer;

  let initialBpm = parseFloat(
    new URLSearchParams(window.location.search).get("bpm") || "120",
  );

  let initialPatterns = new URLSearchParams(window.location.search).get(
    "patterns",
  );
  if (initialPatterns && initialPatterns.length === 48) {
    let values = initialPatterns.split("");
    drummer = new Drummer(initialBpm, {
      hihat: values.slice(0, 16).map(parseInt) as NoteState[],
      snare: values.slice(16, 32).map(parseInt) as NoteState[],
      kicks: values.slice(32, 48).map(parseInt) as NoteState[]
    });
  } else {
    drummer = new Drummer(initialBpm);
  }

  function updateUrl() {
    let url = `?bpm=${drummer.bpm}&patterns=`;
    url += drummer
      .getTrack("hihat")
      .concat(
        drummer.getTrack("snare"),
        drummer.getTrack("kicks"),
      )
      .join("");
    window.history.replaceState({}, "", url);
  }

  events(drummer, [
    Drummer.change(() => {
      this.update();

      updateUrl();
    }),
  ]);

  // update the URL when the component is mounted to clear out any bad url state
  this.queueTask(() => {
    updateUrl();
  });

  events(document, [
    space(() => {
      drummer.toggle();
    }),
    arrowUp(() => {
      drummer.setTempo(drummer.bpm + 1);
    }),
    arrowDown(() => {
      drummer.setTempo(drummer.bpm - 1);
    }),
    arrowLeft(() => {
      drummer.setTempo(drummer.bpm - 1);
    }),
    arrowRight(() => {
      drummer.setTempo(drummer.bpm + 1);
    }),
  ]);

  this.context.set(drummer);

  return () => (
    <Layout>
      <Analyzer />
      <DrumControls />
      <Patterns />
    </Layout>
  );
}

export function Analyzer(this: Remix.Handle) {
  let drummer = this.context.get(DrumMachine);

  let canvas: HTMLCanvasElement;
  let drawing: CanvasRenderingContext2D;

  let pendingRender: number;
  function render() {
    pendingRender = requestAnimationFrame(render);

    const { width: WIDTH, height: HEIGHT } = canvas;

    drawing.clearRect(0, 0, WIDTH, HEIGHT);

    // Get frequency data
    const data = drummer.analyze();
    if (!data) {
      return;
    }

    // subtract 1 * byteLength because we're puttin a pixel of space between
    // each band
    const barWidth = Math.round((WIDTH - data.byteLength) / data.byteLength);
    let x = 0;
    for (let i = 0, l = data.byteLength; i < l; ++i) {
      const volume = (data[i] / 255) * 2.5; // normalize to byte values
      const barHeight = HEIGHT * volume;
      drawing.fillStyle = `rgb(${volume * 100} ${100 - volume * 2.5} 0)`;

      drawing.fillRect(x, HEIGHT - barHeight / 2, barWidth, barHeight);
      x += barWidth + 1; // <- extra pixel
    }
  }

  return (
    <div
      css={{
        gridArea: "spec",
        background: "black",
        borderRadius: "24px",
        padding: "24px",
        height: "452px",
      }}
    >
      <canvas
        on={[
          connect((event) => {
            canvas = event.currentTarget;
            drawing = canvas.getContext("2d", {})!;
            render();
          }),
          disconnect(() => {
            cancelAnimationFrame(pendingRender);
          }),
        ]}
        width="804"
        height="404"
      />
    </div>
  );
}

function DrumControls(this: Remix.Handle) {
  let drummer = this.context.get(DrumMachine);
  let stop: HTMLButtonElement;
  let play: HTMLButtonElement;

  events(drummer, [Drummer.change(() => this.update())]);

  return () => (
    <ControlGroup
      css={{
        "& button:focus-visible": {
          outline: "2px solid #2684FF",
          outlineOffset: "2px",
        },
      }}
    >
      <Button
        css={{ display: "grid", placeContent: "center" }}
        on={[
          tempoTap((event) => {
            drummer.play(event.detail);
          }),
        ]}
      >
        SET TEMPO
      </Button>
      <TempoDisplay />
      <Button
        disabled={drummer.isPlaying}
        on={[
          connect((event) => (play = event.currentTarget)),
          press(() => {
            drummer.play();
            this.queueTask(() => {
              stop.focus();
            });
          }),
        ]}
      >
        PLAY
      </Button>
      <Button
        disabled={!drummer.isPlaying}
        on={[
          connect((event) => (stop = event.currentTarget)),
          press(() => {
            drummer.stop();
            this.queueTask(() => {
              play.focus();
            });
          }),
        ]}
      >
        STOP
      </Button>
    </ControlGroup>
  );
}

function TempoDisplay(this: Remix.Handle) {
  let drummer = this.context.get(DrumMachine);
  return () => (
    <div
      css={{
        display: "flex",
        flexDirection: "row",
        gap: "10px",
        alignItems: "center",
      }}
    >
      <div
        css={{
          display: 'flex',
          height: "100%",
          flex: 1,
          background: "#0B1B05",
          color: "#64C146",
          borderTopLeftRadius: "24px",
          borderBottomLeftRadius: "24px",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          css={{
            display: "flex",
            alignItems: "baseline",
            gap: "2rem",
          }}
        >
          <div
            css={{
              fontSize: "24px",
              fontWeight: 700,
            }}
          >
            BPM
          </div>
          <div
            css={{
              // flex: 1,
              fontSize: "72px",
              fontWeight: 700,
              // position: "relative",
              // top: "22px",
              textAlign: "right",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {drummer.bpm}
          </div>
        </div>
      </div>
      <div
        css={{
          width: "75px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          height: "100%",
          justifyContent: "space-between",
        }}
        // prevent the space bar from playing/stopping the drum machine
        on={space((event) => {
          event.preventDefault();
          event.stopPropagation();
        })}
      >
        <TempoButton
          css={{ borderTopRightRadius: "24px" }}
          orientation="up"
          on={press(() => {
            drummer.setTempo(drummer.bpm + 1);
          })}
        />
        <TempoButton
          css={{ borderBottomRightRadius: "24px" }}
          orientation="down"
          on={press(() => {
            drummer.setTempo(drummer.bpm - 1);
          })}
        />
      </div>
    </div>
  );
}

function Patterns(this: Remix.Handle) {
  let trackButtons: NodeListOf<HTMLButtonElement>;
  let focusedTrack: number = -1;

  let focusTrack = (track: number) => {
    trackButtons[track].focus();
    focusedTrack = track;
  };

  return () => (
    <div
      css={{
        gridArea: "pat",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        fontSize: "180%",
        fontWeight: "bold",
      }}
      tabIndex={0}
      on={[
        connect((event) => {
          trackButtons = event.currentTarget.querySelectorAll("button");
        }),
        escape((event) => {
          event.currentTarget.focus();
        }),
        space((event) => {
          event.stopPropagation();
        }),
        arrowLeft((event) => {
          event.stopPropagation();
          if (focusedTrack === null) return;
          focusTrack((focusedTrack - 1) % trackButtons.length);
        }),
        arrowRight((event) => {
          event.stopPropagation();
          if (focusedTrack === null) return;
          focusTrack((focusedTrack + 1) % trackButtons.length);
        }),
        arrowUp((event) => {
          event.stopPropagation();
          if (focusedTrack === null) return;
          focusTrack(
            (focusedTrack - trackButtons.length / 3 + trackButtons.length) %
              trackButtons.length,
          );
        }),
        arrowDown((event) => {
          event.stopPropagation();
          if (focusedTrack === null) return;
          focusTrack(
            (focusedTrack + trackButtons.length / 3) % trackButtons.length,
          );
        }),
      ]}
    >
      <Track label="Hat" instrument="hihat" />
      <Track label="Snare" instrument="snare" />
      <Track label="Kick" instrument="kicks" />
    </div>
  );
}

function Track(
  this: Remix.Handle,
  { label, instrument }: { label: string; instrument: Instrument },
) {
  const drummer = this.context.get(DrumMachine);
  return () => {
    const pattern = drummer.getTrack(instrument);
    return (
      <div
        css={{
          display: "grid",
          gridTemplateColumns: `2fr repeat(${pattern.length}, 1fr)`,
          gridAutoRows: "auto",
          gap: "8px",

          "& button": {
            border: "none",
            borderRadius: "2px",
            cursor: "pointer",
            userSelect: 'none',
          },
          "& button.off": {
            backgroundColor: "white",
            opacity: 0.2,
          },
          "& button.on": {
            backgroundColor: "rgb(0 255 0)",
            opacity: 0.9,
          },
          "& button.on-accent": {
            backgroundColor: "rgb(255 0 0)",
            opacity: 0.9,
          },
          "& button:focus-visible": {
            outline: "2px solid rgb(0 255 0)",
            outlineOffset: "2px",
          },
        }}
      >
        <label>{label}</label>
        {pattern.map((state, note) => (
          <button
            type="button"
            class={state == 1 ? "on" : state == 2 ? "on-accent" : "off"}
            on={[
              press((e) => { 
                const isAccent = e.detail.originalEvent.shiftKey;
                const s = isAccent ? (state == 2 ? 0 : 2) : (state == 0 ? 1 : 0);                 
                drummer.toggleNote(instrument, note, s);
              }),
            ]}
            tabIndex={-1}
          >
            &#x200b;
          </button>
        ))}
      </div>
    );
  };
}

createRoot(document.body).render(<DrumMachine />);
