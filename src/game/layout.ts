import * as THREE from 'three'
import type { TargetDef } from './data'

/** Pocket height and depth in front of the player (level coordinates, metres). Shared by the game and the teacher screen. */
export const POCKET_Y = 1.3
export const POCKET_Z = -0.72

/** Horizontal position of receptor i when a level shows n of them. */
export function receptorX(i: number, n: number): number {
  return n === 1 ? 0 : i === 0 ? -0.31 : 0.36
}

/** Pocket center and orientation of a receptor placed at x. */
export function placeReceptor(def: TargetDef, x: number, center: THREE.Vector3, quat: THREE.Quaternion): void {
  if (def.sideTilt) {
    // Side view: the pocket opens upwards (outside of the cell), tilted towards the player.
    quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(def.sideTilt))
    center.set(x, 1.27, -0.86)
  } else {
    quat.identity()
    center.set(x, POCKET_Y, POCKET_Z)
  }
}
