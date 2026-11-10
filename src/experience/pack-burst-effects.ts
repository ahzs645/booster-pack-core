import * as THREE from "three";

import type { FoilMaterialPatch } from "./pack-scene-effects";

/**
 * Shader work for the burst opening: the tear strip that peels with the hand,
 * the bright torn edge it leaves behind, and the fan of light that pours out
 * of the opening.
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

/* ----------------------------------- flow ---------------------------------- */

/** Ribbon colours, written as display values: this material skips tone mapping. */
export const FLOW_BANDS = [
  "#ff4f7a",
  "#ff9a48",
  "#ffd85a",
  "#58dba6",
  "#58b6ff",
  "#9478ff",
  "#ff6bd0",
] as const;

export interface FlowUniforms {
  uTime: { value: number };
  /** Overall visibility, 0 – 1. */
  uGlow: { value: number };
  uTip: { value: number };
  uDir: { value: number };
  /** 1 once the wrapper is fully open and every ribbon runs at full length. */
  uOpen: { value: number };
  /** Height of the opening, and how far below it the ribbons converge. */
  uMouth: { value: number };
  uFocus: { value: number };
  /** Half the width of the opening. */
  uHalf: { value: number };
  /** How far a ribbon reaches, and how far up its tail has let go. */
  uReach: { value: number };
  uTail: { value: number };
  /** Extra distance the wave crests have travelled since the pack opened. */
  uCarry: { value: number };
  /** Which colour the fan starts on. */
  uShift: { value: number };
}

export function makeFlowUniforms(): FlowUniforms {
  return {
    uTime: { value: 0 },
    uGlow: { value: 0 },
    uTip: { value: -100 },
    uDir: { value: 1 },
    uOpen: { value: 0 },
    uMouth: { value: 0 },
    uFocus: { value: 1 },
    uHalf: { value: 1 },
    uReach: { value: 4 },
    uTail: { value: 0 },
    uCarry: { value: 0 },
    uShift: { value: 0 },
  };
}

const band = (hex: string): string => {
  const part = (i: number) =>
    (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3);
  return `vec3(${part(1)}, ${part(3)}, ${part(5)})`;
};

/**
 * A fan of ribbons pouring out of the torn part of the opening. It is one
 * quad: each pixel finds the ray it lies on from a point below the pack, and
 * where that ray crosses the opening decides its ribbon. A wave that grows
 * and travels along the ray moves the boundaries, so the fan flows without a
 * single vertex being animated. A ribbon starts once the tear has passed it
 * and lengthens with the distance the tear has run on since.
 */
export function makeFlowMaterial(uniforms: FlowUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      uniform float uTip;
      uniform float uDir;
      uniform float uOpen;
      uniform float uMouth;
      uniform float uFocus;
      uniform float uHalf;
      uniform float uReach;
      uniform float uTail;
      uniform float uCarry;
      uniform float uShift;
      varying vec2 vLocal;

      const float RIBBONS = 28.0;

      vec3 ribbonColour(float index) {
        int i = int(mod(index, 7.0));
        if (i == 0) return ${band(FLOW_BANDS[0])};
        if (i == 1) return ${band(FLOW_BANDS[1])};
        if (i == 2) return ${band(FLOW_BANDS[2])};
        if (i == 3) return ${band(FLOW_BANDS[3])};
        if (i == 4) return ${band(FLOW_BANDS[4])};
        if (i == 5) return ${band(FLOW_BANDS[5])};
        return ${band(FLOW_BANDS[6])};
      }

      void main() {
        vec2 ray = vec2(vLocal.x, vLocal.y - (uMouth - uFocus));
        if (ray.y <= 0.001) discard;
        float reach = length(ray);
        float past = reach - uFocus * reach / ray.y;
        if (past < -0.3) discard;

        float crossing = ray.x * uFocus / ray.y;
        float far = clamp(past / 3.2, 0.0, 1.0);
        float lane = (crossing + uHalf) / (2.0 * uHalf) * RIBBONS;
        lane +=
          (0.1 + 0.85 * far) *
          sin(((past - uCarry) / 0.8 - uTime * 1.4) * 6.2832 + lane * 0.42) +
          sin(uTime * 0.9) * 0.5 * far;
        if (lane < 0.0 || lane > RIBBONS) discard;

        float index = floor(lane);
        float within = lane - index;
        float centre = ((index + 0.5) / RIBBONS * 2.0 - 1.0) * uHalf;
        float behind = (uTip - centre) * uDir;
        if (behind <= 0.0) discard;

        float grown = mix(clamp(behind / 0.55, 0.0, 1.0), 1.0, uOpen);
        float head = uReach * grown;
        float body =
          smoothstep(uTail - 0.5, uTail, past) *
          (1.0 - smoothstep(head - 1.1, head, past));

        vec3 colour = ribbonColour(index + uShift);
        // White hot where it leaves the opening, its own colour further out.
        colour = mix(vec3(1.0), colour, 0.32 + 0.68 * clamp(past / 0.8, 0.0, 1.0));
        float seam = 1.0 - smoothstep(0.0, 0.07, min(within, 1.0 - within));
        colour = mix(colour, vec3(1.0), seam * 0.6);

        float alpha = body * uGlow;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(colour, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
