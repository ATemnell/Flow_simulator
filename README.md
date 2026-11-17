# Flow Cell Simulator

A browser app for drawing a 2D fluidic schematic (syringe pumps, valves, reservoirs, waste, flow cells and pipes) and animating liquid flowing through it, driven by a CSV script.

```
npm install
npm run dev     # open the printed URL
npm test
```

## Using it

- **Edit mode**:
  - Place parts from the palette.
  - **Draw pipes** with the Pipe tool (P): start on a port or anywhere on the canvas. Finish on a port, or double-click (or press Enter) to leave the end open (red ×).
  - **T-junctions:** click an existing pipe to start or end a T-junction there.
  - **Lay out pipes first:** a part placed so a port lands on an × connects to it, and you can drag an × onto a port. Deleting a part keeps its pipes, with × ends. When running, open ends act as sealed ends.
  - **Valves:** drop one on a straight pipe section and it is cut into the pipe.
  - **Properties:** set them in the right-hand panel: pipe width and depth, flow cell volume, and so on.
  - Write the script in the drawer under the canvas.
- **Run mode**:
  - Plays the script. The step list follows playback, the slider seeks, and clicking a step jumps to it.
  - The **Manual** tab gives direct control of the pumps, valves and reservoir colours instead.
- **Save** writes one JSON file that contains the schematic and its script. **Open CSV… / Save CSV** load and save just the script.

## Script format (CSV)

```
# Lines starting with # are comments.
Pump 1, Pump 2, Valve 1, Valve 2, Reservoir A
fill 500 red, fill 0, 1, 0, Buffer #16a34a
100 10, -100 -10, 0, 1,
Wait 2
50 10, 0 0, 1, 0, Sample blue
```

- **Header row:** names of the parts to control (pumps, valves, reservoirs), matched without regard to case.
- **Separator:** `,`, `;` or tab. With `;` or tab, numbers may use a decimal comma.
- **Pump cell:**

  | Cell | Meaning |
  |---|---|
  | `volume flow` | Run the pump. Negative values aspirate (`-100 -10`), positive values dispense. |
  | `0 0`, `stop` or empty | The pump is idle. |
  | `fill 400` or `fill 400 red` | Set the syringe contents instantly, optionally with a colour. |

- **Valve cell:** `1` / `open` or `0` / `closed`. Empty means no change.
- **Reservoir cell:** a colour, optionally after a liquid name: `red`, `#2563eb`, `Sample blue`. Empty means no change. When the colour changes, the new liquid's front follows the old one through the pipes.
- **`Wait N`:** pause for N seconds (or `Wait 1.5 min`).
- **Timing:** all pumps in a row start together, and each runs for |volume| ÷ |flow|. The next row starts when the slowest pump of the row has finished.
- **Units:** µL, µL/min and seconds by default. The selectors in the script drawer switch them to mL, µL/s, mL/min or minutes.
- **Checks:**
  - Errors give the line and the cell. A script with errors does not run.
  - A warning appears when a syringe would run empty or overfill. During the run, a pump stops by itself when that happens.

## How the simulation works

- **Flow:** `src/sim/solver.ts`. Pumps impose flow rates, while reservoirs and waste are open ends. Pipes are rectangular channels (width × depth, default 0.3 × 0.35 mm). Flow splits between parallel paths by the laminar conductance of a rectangular channel, a³·b·(1 − 0.63·a/b)/(12·L), with a ≤ b the two sides. A setup that can't move, such as a pump pushing against a closed valve, is reported instead of solved.
- **Transport:** `src/sim/transport.ts`. Each pipe holds ordered plugs of liquid, so a new liquid's front pushes the old one ahead of it. Where streams merge at a junction, they blend.
- **Flow cell:** `src/sim/flowcell.ts`. Inlet streams flow side by side across the chamber (its volume is a flow cell setting, default 20 µL) as bands, each as wide as its share of the flow. Each outlet takes its own slice of the bands.
