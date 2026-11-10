import * as THREE from "three";

import type { FoilMaterialPatch } from "./pack-scene-effects";

/**
 * Shader work for the burst opening: the tear strip that peels with the hand
 * and the bright torn edge it leaves behind.
 */

/* ---------------------------------- peel ----------------------------------- */

export interface PeelUniforms {
  /** Mesh-local x the tear has reached. */
  uTip: { value: number };
  /** +1 when the tear travels toward +x, so everything at lower x is loose. */
  uDir: { value: number };
  /** Height of the tear line at the tip: the loose strip hinges here. */
  uTipY: { value: number };
  /** Curvature at the tip, and how much it tightens per unit along the strip. */
  uCurl: { value: number };
  uCurl2: { value: number };
  /** The loose end lifting up and leaning out, in radians. */
  uLift: { value: number };
  uPitch: { value: number };
  /** +1 with the display face toward the camera, -1 when the pack is reversed. */
  uFace: { value: number };
}

export function makePeelUniforms(): PeelUniforms {
  return {
    uTip: { value: -100 },
    uDir: { value: 1 },
    uTipY: { value: 0 },
    uCurl: { value: 0 },
    uCurl2: { value: 0 },
    uLift: { value: 0 },
    uPitch: { value: 0 },
    uFace: { value: 1 },
  };
}

/**
 * The strip is not animated as a rigid piece. Each vertex behind the tear tip
 * is carried along a curve whose curvature grows with distance from the tip,
 * so the foil rolls up like a real strip instead of hinging like a door. The
 * curve has no closed form once the curvature varies, so it is integrated in
 * sixteen steps per vertex — nothing at the size of this mesh.
 */
const PEEL_VERTEX = /* glsl */ `
uniform float uTip;
uniform float uDir;
uniform float uTipY;
uniform float uCurl;
uniform float uCurl2;
uniform float uLift;
uniform float uPitch;
uniform float uFace;

void burstPeel(inout vec3 p, inout vec3 n) {
  float s = (uTip - p.x) * uDir;
  if (s <= 0.0) return;

  float ds = s / 16.0;
  vec2 arc = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    float at = (float(i) + 0.5) * ds;
    float bend = uCurl * at + uCurl2 * at * at;
    arc += vec2(cos(bend), sin(bend)) * ds;
  }
  float turn = uCurl * s + uCurl2 * s * s;
  float ct = cos(turn);
  float st = sin(turn) * uDir * uFace;
  // Where the wrapper's own x and z axes point once it has rolled this far.
  vec3 axisX = vec3(ct, 0.0, -st);
  vec3 axisZ = vec3(st, 0.0, ct);

  vec3 q = vec3(-uDir * arc.x, p.y - uTipY, uFace * arc.y) + p.z * axisZ;
  vec3 m = n.x * axisX + vec3(0.0, n.y, 0.0) + n.z * axisZ;

  // The lift fades in away from the tip, so the strip twists up out of the
  // wrapper rather than shearing off it.
  float ease = 1.0 - exp(-s * 3.5);
  float lift = -uDir * uLift * ease;
  float cl = cos(lift);
  float sl = sin(lift);
  q = vec3(q.x * cl - q.y * sl, q.x * sl + q.y * cl, q.z);
  m = vec3(m.x * cl - m.y * sl, m.x * sl + m.y * cl, m.z);

  float pitch = uFace * uPitch * ease;
  float cp = cos(pitch);
  float sp = sin(pitch);
  q = vec3(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);
  m = vec3(m.x, m.y * cp - m.z * sp, m.y * sp + m.z * cp);

  p = vec3(uTip, uTipY, 0.0) + q;
  n = m;
}
`;

/** The inside of a foil wrapper is bare metal, not a mirror image of the print. */
const FOIL_INSIDE_FRAGMENT = /* glsl */ `
#include <map_fragment>
if (!gl_FrontFacing) {
  float sheen = 0.5 + 0.5 * sin(vMapUv.x * 61.0 + vMapUv.y * 17.0);
  diffuseColor.rgb = mix(vec3(0.74, 0.77, 0.83), vec3(0.93, 0.95, 0.98), sheen);
}
`;

function showFoilInside(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    FOIL_INSIDE_FRAGMENT,
  );
}

/** Wrapper body: unchanged outside, silver inside. */
export const BODY_PATCH: FoilMaterialPatch = {
  key: "pack-burst-body",
  apply: (shader) => showFoilInside(shader),
};

/** Tear strip: silver inside, and rolled up behind the tip of the tear. */
export function makeStripPatch(uniforms: PeelUniforms): FoilMaterialPatch {
  return {
    key: "pack-burst-strip",
    apply: (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${PEEL_VERTEX}`)
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          vec3 objectNormal = vec3(normal);
          vec3 burstPosition = vec3(position);
          burstPeel(burstPosition, objectNormal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif
          `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          vec3 transformed = burstPosition;
          #ifdef USE_ALPHAHASH
            vPosition = vec3(position);
          #endif
          `,
        );
      showFoilInside(shader);
    },
  };
}

/* ----------------------------------- lip ----------------------------------- */

/**
 * The torn edge left on the wrapper: a thin, uneven line of bright metal that
 * appears only where the tear has already passed.
 */
export function makeLipMaterial(uniforms: PeelUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTip: uniforms.uTip, uDir: uniforms.uDir },
    vertexShader: /* glsl */ `
      varying float vX;
      void main() {
        vX = position.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTip;
      uniform float uDir;
      varying float vX;
      void main() {
        if ((uTip - vX) * uDir <= 0.0) discard;
        float metal = 0.5 + 0.5 * sin(vX * 23.0) * sin(vX * 7.3 + 1.0);
        gl_FragColor = vec4(mix(vec3(0.76, 0.79, 0.86), vec3(1.0), metal), 0.95);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
