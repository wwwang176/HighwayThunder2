/**
 * A spot light's shadow bias in metres: three's `shadow.bias` is in its map's depth (0 at its camera's near, 1 at
 * far, perspective: far finer near the lamp than far from it), so one bias is ever more metres the further off - with
 * the near plane close to the lamp, metres at a few tens of metres (a car's shadow starting that far behind it: come
 * loose). The depth `offset` m makes at `z` m from the lamp (near and far its shadow camera's): the bias that puts
 * what is that far off `offset` m back.
 */
export function depthBias(offset: number, z: number, near: number, far: number): number {
  return (offset * near * far) / (z * z * (far - near));
}
