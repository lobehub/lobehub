import { cx } from 'antd-style';
import { Mesh, Program, Renderer, Triangle } from 'ogl';
import React, { useEffect, useRef, useState } from 'react';

export type RaysOrigin =
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'right'
  | 'left'
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left';

interface LightRaysProps {
  className?: string;
  distortion?: number;
  fadeDistance?: number;
  followMouse?: boolean;
  lightSpread?: number;
  mouseInfluence?: number;
  noiseAmount?: number;
  pulsating?: boolean;
  rayLength?: number;
  raysColor?: string;
  raysColorSecondary?: string;
  raysOrigin?: RaysOrigin;
  // 第二种颜色
  raysSpeed?: number;
  saturation?: number;
}

const DEFAULT_COLOR = '#ffffff';

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
    : [1, 1, 1];
};

const getAnchorAndDir = (
  origin: RaysOrigin,
  w: number,
  h: number,
): { anchor: [number, number]; dir: [number, number] } => {
  const outside = 0.2;
  switch (origin) {
    case 'top-left': {
      return { anchor: [0, -outside * h], dir: [0, 1] };
    }
    case 'top-right': {
      return { anchor: [w, -outside * h], dir: [0, 1] };
    }
    case 'left': {
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] };
    }
    case 'right': {
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] };
    }
    case 'bottom-left': {
      return { anchor: [0, (1 + outside) * h], dir: [0, -1] };
    }
    case 'bottom-center': {
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] };
    }
    case 'bottom-right': {
      return { anchor: [w, (1 + outside) * h], dir: [0, -1] };
    }
    default: {
      // "top-center"
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] };
    }
  }
};

const LightRays: React.FC<LightRaysProps> = ({
  raysOrigin = 'top-center',
  raysColor = DEFAULT_COLOR,
  raysColorSecondary,
  raysSpeed = 1,
  lightSpread = 1,
  rayLength = 2,
  pulsating = false,
  fadeDistance = 1,
  saturation = 1,
  followMouse = true,
  mouseInfluence = 0.1,
  noiseAmount = 0,
  distortion = 0,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniformsRef = useRef<any>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const smoothMouseRef = useRef({ x: 0.5, y: 0.5 });
  const animationIdRef = useRef<number | null>(null);
  const meshRef = useRef<any>(null);
  const cleanupFunctionRef = useRef<(() => void) | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
    );

    observerRef.current.observe(containerRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !containerRef.current) return;

    if (cleanupFunctionRef.current) {
      cleanupFunctionRef.current();
      cleanupFunctionRef.current = null;
    }

    const initializeWebGL = async () => {
      if (!containerRef.current) return;

      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      if (!containerRef.current) return;

      const renderer = new Renderer({
        alpha: true,
        dpr: Math.min(window.devicePixelRatio, 2),
      });
      rendererRef.current = renderer;

      const gl = renderer.gl;
      gl.canvas.style.width = '100%';
      gl.canvas.style.height = '100%';

      while (containerRef.current.firstChild) {
        containerRef.current.firstChild.remove();
      }
      containerRef.current.append(gl.canvas);

      const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

      const frag = `precision highp float;

uniform float iTime;
uniform vec2  iResolution;

uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform vec3  raysColorSecondary;
uniform float hasSecondaryColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  
  // 增强中心光束的强度，使光线更加聚焦
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
  
  // 调整衰减曲线，使光线更加柔和
  float fadeFalloff = pow(clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.0, 1.0), 0.8);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;

  // 增强动态变化的幅度
  float baseStrength = clamp(
    (0.5 + 0.25 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.35 + 0.3 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.2
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  // 创建两组光束：主色和次色
  float ray1 = rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
  float ray2 = rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);
  float ray3 = rayStrength(rayPos, finalRayDir, coord, 15.5423, 27.3342, 0.8 * raysSpeed);
  float ray4 = rayStrength(rayPos, finalRayDir, coord, 41.2314, 11.2341, 1.3 * raysSpeed);

  // 主色光束组合
  float primaryIntensity = ray1 * 0.35 + ray2 * 0.3;
  // 次色光束组合
  float secondaryIntensity = ray3 * 0.25 + ray4 * 0.2;
  
  if (hasSecondaryColor > 0.5) {
    // 双色模式：使用渐变混合
    vec3 primaryColor = raysColor * primaryIntensity;
    vec3 secondaryColor = raysColorSecondary * secondaryIntensity;
    
    // 基于距离的颜色混合，创建渐变效果
    float distance = length(coord - rayPos);
    float maxDist = iResolution.x * rayLength * 0.8;
    float mixFactor = smoothstep(0.0, maxDist, distance);
    
    // 混合两种颜色
    fragColor.rgb = mix(primaryColor, secondaryColor, mixFactor);
    
    // 在交叠区域增强亮度
    float totalIntensity = primaryIntensity + secondaryIntensity;
    float overlapBoost = smoothstep(0.8, 2.0, totalIntensity);
    fragColor.rgb += fragColor.rgb * overlapBoost * 0.4;
    
    // 添加色彩混合的高光效果
    float colorBlend = primaryIntensity * secondaryIntensity;
    vec3 blendedHighlight = mix(raysColor, raysColorSecondary, 0.5) * colorBlend * 0.6;
    fragColor.rgb += blendedHighlight;
    
    fragColor.a = totalIntensity;
  } else {
    // 单色模式：保持原有逻辑
    float totalIntensity = primaryIntensity + secondaryIntensity;
    fragColor = vec4(raysColor * totalIntensity, totalIntensity);
    
    float overlapBoost = smoothstep(1.0, 2.5, totalIntensity);
    fragColor.rgb += fragColor.rgb * overlapBoost * 0.3;
  }

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  // 只在单色模式下应用额外的颜色调整
  if (hasSecondaryColor < 0.5) {
    float brightness = 1.0 - (coord.y / iResolution.y);
    fragColor.x *= 0.2 + brightness * 0.9;
    fragColor.y *= 0.4 + brightness * 0.7;
    fragColor.z *= 0.6 + brightness * 0.6;
  }

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }
  
  // 软限制最大亮度，避免过曝
  fragColor.rgb = fragColor.rgb / (1.0 + fragColor.rgb * 0.3);
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor  = color;
}`;

      const uniforms = {
        distortion: { value: distortion },
        fadeDistance: { value: fadeDistance },

        hasSecondaryColor: { value: raysColorSecondary ? 1 : 0 },
        iResolution: { value: [1, 1] },

        iTime: { value: 0 },
        lightSpread: { value: lightSpread },
        mouseInfluence: { value: mouseInfluence },
        mousePos: { value: [0.5, 0.5] },
        noiseAmount: { value: noiseAmount },
        pulsating: { value: pulsating ? 1 : 0 },
        rayDir: { value: [0, 1] },
        rayLength: { value: rayLength },
        rayPos: { value: [0, 0] },
        raysColor: { value: hexToRgb(raysColor) },
        raysColorSecondary: {
          value: raysColorSecondary ? hexToRgb(raysColorSecondary) : [0, 0, 0],
        },
        raysSpeed: { value: raysSpeed },
        saturation: { value: saturation },
      };
      uniformsRef.current = uniforms;

      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        fragment: frag,
        uniforms,
        vertex: vert,
      });
      const mesh = new Mesh(gl, { geometry, program });
      meshRef.current = mesh;

      const updatePlacement = () => {
        if (!containerRef.current || !renderer) return;

        renderer.dpr = Math.min(window.devicePixelRatio, 2);

        const { clientWidth: wCSS, clientHeight: hCSS } = containerRef.current;
        renderer.setSize(wCSS, hCSS);

        const dpr = renderer.dpr;
        const w = wCSS * dpr;
        const h = hCSS * dpr;

        uniforms.iResolution.value = [w, h];

        const { anchor, dir } = getAnchorAndDir(raysOrigin, w, h);
        uniforms.rayPos.value = anchor;
        uniforms.rayDir.value = dir;
      };

      const loop = (t: number) => {
        if (!rendererRef.current || !uniformsRef.current || !meshRef.current) {
          return;
        }

        uniforms.iTime.value = t * 0.001;

        if (followMouse && mouseInfluence > 0) {
          const smoothing = 0.92;

          smoothMouseRef.current.x =
            smoothMouseRef.current.x * smoothing + mouseRef.current.x * (1 - smoothing);
          smoothMouseRef.current.y =
            smoothMouseRef.current.y * smoothing + mouseRef.current.y * (1 - smoothing);

          uniforms.mousePos.value = [smoothMouseRef.current.x, smoothMouseRef.current.y];
        }

        try {
          renderer.render({ scene: mesh });
          animationIdRef.current = requestAnimationFrame(loop);
        } catch (error) {
          console.warn('WebGL rendering error:', error);
          return;
        }
      };

      window.addEventListener('resize', updatePlacement);
      updatePlacement();
      animationIdRef.current = requestAnimationFrame(loop);

      cleanupFunctionRef.current = () => {
        if (animationIdRef.current) {
          cancelAnimationFrame(animationIdRef.current);
          animationIdRef.current = null;
        }

        window.removeEventListener('resize', updatePlacement);

        if (renderer) {
          try {
            const canvas = renderer.gl.canvas;
            const loseContextExt = renderer.gl.getExtension('WEBGL_lose_context');
            if (loseContextExt) {
              loseContextExt.loseContext();
            }

            if (canvas && canvas.parentNode) {
              canvas.remove();
            }
          } catch (error) {
            console.warn('Error during WebGL cleanup:', error);
          }
        }

        rendererRef.current = null;
        uniformsRef.current = null;
        meshRef.current = null;
      };
    };

    initializeWebGL();

    return () => {
      if (cleanupFunctionRef.current) {
        cleanupFunctionRef.current();
        cleanupFunctionRef.current = null;
      }
    };
  }, [
    isVisible,
    raysOrigin,
    raysColor,
    raysColorSecondary,
    raysSpeed,
    lightSpread,
    rayLength,
    pulsating,
    fadeDistance,
    saturation,
    followMouse,
    mouseInfluence,
    noiseAmount,
    distortion,
  ]);

  useEffect(() => {
    if (!uniformsRef.current || !containerRef.current || !rendererRef.current) return;

    const u = uniformsRef.current;
    const renderer = rendererRef.current;

    u.raysColor.value = hexToRgb(raysColor);
    u.raysColorSecondary.value = raysColorSecondary ? hexToRgb(raysColorSecondary) : [0, 0, 0];
    u.hasSecondaryColor.value = raysColorSecondary ? 1 : 0;
    u.raysSpeed.value = raysSpeed;
    u.lightSpread.value = lightSpread;
    u.rayLength.value = rayLength;
    u.pulsating.value = pulsating ? 1 : 0;
    u.fadeDistance.value = fadeDistance;
    u.saturation.value = saturation;
    u.mouseInfluence.value = mouseInfluence;
    u.noiseAmount.value = noiseAmount;
    u.distortion.value = distortion;

    const { clientWidth: wCSS, clientHeight: hCSS } = containerRef.current;
    const dpr = renderer.dpr;
    const { anchor, dir } = getAnchorAndDir(raysOrigin, wCSS * dpr, hCSS * dpr);
    u.rayPos.value = anchor;
    u.rayDir.value = dir;
  }, [
    raysColor,
    raysColorSecondary,
    raysSpeed,
    lightSpread,
    raysOrigin,
    rayLength,
    pulsating,
    fadeDistance,
    saturation,
    mouseInfluence,
    noiseAmount,
    distortion,
  ]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !rendererRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      mouseRef.current = { x, y };
    };

    if (followMouse) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [followMouse]);

  return (
    <div
      className={cx('light-rays-container', className)}
      ref={containerRef}
      style={{
        height: '100%',
        pointerEvents: 'none',
        position: 'relative',
        width: '100%',
        zIndex: 5,
      }}
    />
  );
};

export default LightRays;
