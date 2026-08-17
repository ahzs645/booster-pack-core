"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Procedural crinkle normal map so the foil catches light unevenly. */
export function makeWrinkleNormalTexture(): THREE.DataTexture {
  const width = 128;
  const height = 192;
  const heights = new Float32Array(width * height);
  for (let bump = 0; bump < 70; bump += 1) {
    const centerX = Math.random() * width;
    const centerY = Math.random() * height;
    const radius = 4 + Math.random() * 16;
    const amplitude = (Math.random() - 0.5) * 1.8;
    const startX = Math.max(0, Math.floor(centerX - radius));
    const endX = Math.min(width - 1, Math.ceil(centerX + radius));
    const startY = Math.max(0, Math.floor(centerY - radius));
    const endY = Math.min(height - 1, Math.ceil(centerY + radius));
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const distanceSquared =
          ((x - centerX) ** 2 + (y - centerY) ** 2) / (radius * radius);
        if (distanceSquared < 1) {
          heights[y * width + x] +=
            amplitude * Math.exp(-distanceSquared * 3);
        }
      }
    }
  }
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] += (Math.random() - 0.5) * 0.3;
  }

  const data = new Uint8Array(width * height * 4);
  const strength = 1.6;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const xBefore = heights[y * width + Math.max(0, x - 1)];
      const xAfter = heights[y * width + Math.min(width - 1, x + 1)];
      const yBefore = heights[Math.max(0, y - 1) * width + x];
      const yAfter = heights[Math.min(height - 1, y + 1) * width + x];
      const normal = new THREE.Vector3(
        -(xAfter - xBefore) * strength,
        -(yAfter - yBefore) * strength,
        1,
      ).normalize();
      const index = (y * width + x) * 4;
      data[index] = Math.round(normal.x * 127 + 128);
      data[index + 1] = Math.round(normal.y * 127 + 128);
      data[index + 2] = Math.round(normal.z * 127 + 128);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const HOLO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uTilt;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float facing = clamp(dot(normalize(vViewDirW), normalize(vNormalW)), 0.0, 1.0);
    float fres = pow(1.0 - facing, 1.2) * 0.6 + 0.4;
    float band1 = sin((vUv.x + vUv.y) * 11.0 + uTilt.x * 5.0 + uTime * 0.7);
    float band2 = sin((vUv.x - vUv.y) * 8.0 - uTilt.y * 5.0 - uTime * 0.5);
    float mask =
      smoothstep(0.55, 0.95, band1 * 0.5 + 0.5) * 0.7 +
      smoothstep(0.6, 0.95, band2 * 0.5 + 0.5) * 0.5;
    vec3 col = hsv2rgb(vec3(
      fract(vUv.x * 0.5 + vUv.y * 0.35 + uTilt.x * 0.25 + uTime * 0.02),
      0.65,
      1.0
    ));
    gl_FragColor = vec4(col * mask * fres * uIntensity, 0.0);
  }
`;

export function makeHoloMaterial(intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uTilt: { value: new THREE.Vector2() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Procedural indoor environment so the foil has something to reflect. */
export function FoilEnvironment() {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(renderer);
    const environment = generator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    scene.environment = environment;
    return () => {
      scene.environment = null;
      environment.dispose();
      generator.dispose();
    };
  }, [renderer, scene]);
  return null;
}

interface FoilMaterialProps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  materialRef?: (material: THREE.MeshPhysicalMaterial | null) => void;
  /** Pitched slats face the bright environment ceiling. */
  dim?: boolean;
  /** Side walls render double-sided so winding never culls them. */
  doubleSide?: boolean;
}

export function FoilMaterial({
  map,
  normalMap,
  materialRef,
  dim = false,
  doubleSide = false,
}: FoilMaterialProps) {
  return (
    <meshPhysicalMaterial
      ref={materialRef}
      side={doubleSide ? THREE.DoubleSide : THREE.FrontSide}
      map={map}
      normalMap={normalMap}
      normalScale={new THREE.Vector2(0.035, 0.035)}
      metalness={0}
      roughness={dim ? 0.9 : 0.82}
      clearcoat={dim ? 0.04 : 0.08}
      clearcoatRoughness={0.78}
      clearcoatNormalMap={normalMap}
      clearcoatNormalScale={new THREE.Vector2(0.012, 0.012)}
      ior={1.46}
      specularIntensity={dim ? 0.06 : 0.1}
      iridescence={0}
      iridescenceIOR={1.3}
      envMapIntensity={dim ? 0.025 : 0.05}
      transparent
      alphaTest={0.02}
    />
  );
}
