/** Demo script for the two-inlet flow cell example (µL, µL/min, seconds). */
export const twoInletFlowCellScript = `# Two-inlet flow cell demo. Volumes in µL, flows in µL/min, Wait in seconds.
# Pump cells: "volume flow" (negative = aspirate), "fill 500 red" sets the syringe, empty = idle.
# Valve cells: 1 = open, 0 = closed. Reservoir cells: "[liquid name] colour".
Pump 1, Pump 2, Valve 1, Valve 2, Reservoir A
fill 500 #dc2626, fill 0, 1, 0, Buffer #16a34a
# Equal inflows: pump 1 pushes 30 and pump 2 pulls 60, so the reservoir supplies 30 (50/50 bands).
60 30, -120 -60, , ,
# Less from pump 1: the reservoir supplies 50 (5/6 buffer, 1/6 red).
40 10, -240 -60, , ,
# Switch the reservoir to a blue sample; its front follows the buffer to the flow cell.
, , , , Sample #2563eb
300 30, -600 -60, , ,
Wait 30
# Empty pump 2 to waste.
0 0, 300 60, 0, 1,
`;
