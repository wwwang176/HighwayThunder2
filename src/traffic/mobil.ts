export interface MobilInputs {
  selfNew: number; // my accel after the change
  selfOld: number; // my accel if I stay
  newFollowerNew: number; // accel of the car behind me in the target lane, after
  newFollowerOld: number; // ... before
  oldFollowerNew: number; // accel of the car behind me in my lane, after I leave
  oldFollowerOld: number; // ... before
  politeness: number;
  bias: number; // lane preference (e.g. keep right)
}

/** MOBIL incentive: change lanes when this exceeds the threshold. */
export function mobilIncentive(o: MobilInputs): number {
  return (
    o.selfNew -
    o.selfOld +
    o.politeness * (o.newFollowerNew - o.newFollowerOld + o.oldFollowerNew - o.oldFollowerOld) +
    o.bias
  );
}

/** MOBIL safety criterion: the new follower must not need to brake harder than bSafe. */
export function mobilSafe(newFollowerNew: number, bSafe = 4): boolean {
  return newFollowerNew >= -bSafe;
}
