import { Billboard, Html, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useTheme } from 'antd-style';
import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { type QueryTagsResult } from '@/database/models/userMemory';
import UserAvatar from '@/features/User/UserAvatar';

// 配置常量
const CONFIG = {
  // 连接线数量系数 (实际数量 = 标签数 * 系数)
  CONNECTION_RATIO: 0.8,
  // 最大连接线数量
  MAX_CONNECTIONS: 40,

  MAX_DURATION: 8,

  // 连接线生命周期范围（秒）
  MIN_DURATION: 2,
  // 流动粒子数量（每条线）
  PARTICLES_PER_LINE: 3,
  // 新连接线生成概率（每次检查）
  SPAWN_PROBABILITY: 0.3,
  // 检查间隔（秒）
  UPDATE_INTERVAL: 0.1,
} as const;

interface WordProps {
  position: THREE.Vector3;
  size: number;
  text: string;
}

const Word = memo<WordProps>(
  ({ position, text, size }) => {
    const theme = useTheme();
    const ref = useRef<any>(null);
    const [hovered, setHovered] = useState(false);

    const fontProps = {
      'fontSize': size * 0.6,
      'fontWeight': 600,
      'letterSpacing': -0.05,
      'lineHeight': 1,
      'material-toneMapped': false,
    };

    useEffect(() => {
      if (hovered) document.body.style.cursor = 'pointer';
      return () => {
        document.body.style.cursor = 'auto';
      };
    }, [hovered]);

    useFrame(() => {
      if (ref.current) {
        const targetColor = hovered ? theme.colorInfo : theme.colorText;
        ref.current.material.color.lerp(new THREE.Color(targetColor), 0.1);
      }
    });

    return (
      <Billboard position={position}>
        <Text
          ref={ref}
          onPointerOut={() => setHovered(false)}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          {...fontProps}
        >
          {text}
        </Text>
      </Billboard>
    );
  },
  (prevProps, nextProps) => {
    // 只在 position、text、size 改变时才重新渲染
    return (
      prevProps.position === nextProps.position &&
      prevProps.text === nextProps.text &&
      prevProps.size === nextProps.size
    );
  },
);

interface ParticleProps {
  end: THREE.Vector3;
  index: number;
  start: THREE.Vector3;
}

// 流动的光点粒子
const FlowingParticle = memo<ParticleProps>(
  ({ start, end, index }) => {
    const theme = useTheme();
    const ref = useRef<THREE.Mesh>(null);
    const offset = useMemo(() => Math.random() * Math.PI * 2, []);

    useFrame((state) => {
      if (ref.current) {
        const time = state.clock.getElapsedTime();
        const speed = 0.5 + index * 0.1;
        const progress = ((time * speed + offset) % (Math.PI * 2)) / (Math.PI * 2);

        // 沿着线条移动
        ref.current.position.lerpVectors(start, end, progress);

        // 脉冲效果
        const pulse = Math.sin(time * 3 + offset) * 0.5 + 1;
        ref.current.scale.setScalar(pulse * 0.3);

        // 渐变透明度（两端透明，中间明亮）
        const alpha = Math.sin(progress * Math.PI) * 0.8;
        if (ref.current.material instanceof THREE.MeshBasicMaterial) {
          ref.current.material.opacity = alpha;
        }
      }
    });

    return (
      <mesh ref={ref}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial transparent color={theme.colorInfo} opacity={0.8} />
      </mesh>
    );
  },
  (prevProps, nextProps) => {
    // 只在 start、end 引用改变时才重新渲染
    return (
      prevProps.start === nextProps.start &&
      prevProps.end === nextProps.end &&
      prevProps.index === nextProps.index
    );
  },
);

interface ConnectionLineProps {
  birthTime: number;
  duration: number;
  end: THREE.Vector3;
  index: number;
  start: THREE.Vector3;
}

const ConnectionLine = memo<ConnectionLineProps>(
  ({ start, end, index, birthTime, duration }) => {
    const theme = useTheme();
    const lineRef = useRef<THREE.Line>(null);
    const glowRef = useRef<THREE.Line>(null);

    // 为每条线生成独特的相位偏移
    const phaseOffset = useMemo(() => Math.random() * Math.PI * 2, []);

    useFrame((state) => {
      const time = state.clock.getElapsedTime();

      // 在内部计算 lifeProgress
      const elapsed = time - birthTime;
      const lifeProgress = Math.min(Math.max(elapsed / duration, 0), 1);

      if (lineRef.current) {
        // 淡入淡出效果：基于生命周期进度
        let lifeCycleOpacity = 1;
        if (lifeProgress < 0.15) {
          // 淡入阶段 (0-15%)
          lifeCycleOpacity = lifeProgress / 0.15;
        } else if (lifeProgress > 0.85) {
          // 淡出阶段 (85%-100%)
          lifeCycleOpacity = (1 - lifeProgress) / 0.15;
        }

        // 主线条：波动透明度 * 生命周期透明度
        const baseOpacity = (Math.sin(time * 1.5 + phaseOffset) * 0.2 + 0.4) * lifeCycleOpacity;
        (lineRef.current.material as THREE.LineBasicMaterial).opacity = baseOpacity;
      }

      if (glowRef.current) {
        // 光晕效果
        let lifeCycleOpacity = 1;
        const elapsed = time - birthTime;
        const lifeProgress = Math.min(Math.max(elapsed / duration, 0), 1);

        if (lifeProgress < 0.15) {
          lifeCycleOpacity = lifeProgress / 0.15;
        } else if (lifeProgress > 0.85) {
          lifeCycleOpacity = (1 - lifeProgress) / 0.15;
        }

        const glowOpacity = (Math.sin(time * 0.8 + phaseOffset) * 0.1 + 0.15) * lifeCycleOpacity;
        (glowRef.current.material as THREE.LineBasicMaterial).opacity = glowOpacity;
      }
    });

    // 创建渐变色线条
    const { mainLine, glowLine } = useMemo(() => {
      const points = [start, end];
      const geom = new THREE.BufferGeometry().setFromPoints(points);

      // 创建颜色渐变
      const colorArray = new Float32Array(6); // 2 points * 3 (RGB)
      const color1 = new THREE.Color(theme.colorPrimary);
      const color2 = new THREE.Color(theme.colorInfo);

      colorArray[0] = color1.r;
      colorArray[1] = color1.g;
      colorArray[2] = color1.b;
      colorArray[3] = color2.r;
      colorArray[4] = color2.g;
      colorArray[5] = color2.b;

      geom.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

      // 创建主线条
      const mainMaterial = new THREE.LineBasicMaterial({
        color: theme.colorPrimary,
        opacity: 0.4,
        transparent: true,
        vertexColors: true,
      });
      const main = new THREE.Line(geom, mainMaterial);

      // 创建光晕线条
      const glowMaterial = new THREE.LineBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: theme.colorInfo,
        opacity: 0.15,
        transparent: true,
      });
      const glow = new THREE.Line(geom.clone(), glowMaterial);

      return { geometry: geom, glowLine: glow, mainLine: main };
    }, [start, end, theme.colorPrimary, theme.colorInfo]);

    // 生成流动粒子
    const particles = useMemo(() => {
      return Array.from({ length: CONFIG.PARTICLES_PER_LINE }, (_, i) => (
        <FlowingParticle end={end} index={i} key={`particle-${index}-${i}`} start={start} />
      ));
    }, [start, end, index]);

    return (
      <group>
        {/* 主线条 */}
        <primitive object={mainLine} ref={lineRef} />

        {/* 光晕层 - 更粗更透明 */}
        <primitive object={glowLine} ref={glowRef} />

        {/* 流动粒子 */}
        {particles}
      </group>
    );
  },
  (prevProps, nextProps) => {
    // 只在 start、end 引用改变时才重新渲染
    // birthTime 和 duration 对于同一个连接应该是不变的
    return (
      prevProps.start === nextProps.start &&
      prevProps.end === nextProps.end &&
      prevProps.birthTime === nextProps.birthTime &&
      prevProps.duration === nextProps.duration
    );
  },
);

// 中心头像组件
const CenterAvatar = memo(() => {
  return (
    <Html
      center
      position={[0, 0, 0]}
      style={{
        pointerEvents: 'none',
      }}
    >
      <UserAvatar shape={'circle'} size={80} />
    </Html>
  );
});

interface CloudProps {
  radius?: number;
  tags: QueryTagsResult[];
}

const Cloud = memo<CloudProps>(({ tags, radius = 20 }) => {
  const groupRef = useRef<THREE.Group>(null);

  // 计算标签位置和大小
  const wordsData = useMemo(() => {
    if (!tags.length) return [];

    const maxCount = Math.max(...tags.map((t) => t.count));
    const minCount = Math.min(...tags.map((t) => t.count));
    const countRange = maxCount - minCount || 1;

    const spherical = new THREE.Spherical();
    const data = tags.map((tag, i) => {
      // 使用黄金角螺旋分布算法，使标签在球面上均匀分布
      const phi = Math.acos(1 - (2 * (i + 0.5)) / tags.length);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const position = new THREE.Vector3().setFromSpherical(spherical.set(radius, phi, theta));

      // 根据 count 计算字体大小 (范围: 1.5 - 4)
      const normalizedCount = (tag.count - minCount) / countRange;
      const size = 1.5 + normalizedCount * 2.5;

      return {
        position,
        size,
        text: tag.tag,
      };
    });

    return data;
  }, [tags, radius]);

  // 连接线数量
  const connectionCount = useMemo(() => {
    if (wordsData.length < 2) return 0;
    return Math.min(Math.floor(wordsData.length * CONFIG.CONNECTION_RATIO), CONFIG.MAX_CONNECTIONS);
  }, [wordsData.length]);

  // 动态连接线状态
  interface ConnectionState {
    birthTime: number;
    duration: number;
    end: THREE.Vector3;
    id: string;
    start: THREE.Vector3;
  }

  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const lastUpdateTime = useRef(0);
  const isInitialized = useRef(false);
  const currentTime = useRef(0);
  const connectionIdCounter = useRef(0);

  // 生成一个随机连接
  const generateRandomConnection = useMemo(
    () => (currentTime: number) => {
      if (wordsData.length < 2) return null;

      const idx1 = Math.floor(Math.random() * wordsData.length);
      let idx2 = Math.floor(Math.random() * wordsData.length);

      let attempts = 0;
      while (idx2 === idx1 && attempts < 50) {
        idx2 = Math.floor(Math.random() * wordsData.length);
        attempts++;
      }

      if (attempts >= 50) return null;

      // 随机持续时间
      const duration =
        CONFIG.MIN_DURATION + Math.random() * (CONFIG.MAX_DURATION - CONFIG.MIN_DURATION);

      // 生成唯一 ID
      connectionIdCounter.current += 1;
      const id = `conn-${connectionIdCounter.current}`;

      return {
        birthTime: currentTime,
        duration,
        end: wordsData[idx2].position,
        id,
        start: wordsData[idx1].position,
      };
    },
    [wordsData],
  );

  // 当 wordsData 或 connectionCount 变化时重置初始化状态
  useEffect(() => {
    isInitialized.current = false;
    setConnections([]);
  }, [connectionCount]);

  // 动态更新连接线
  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    currentTime.current = time;

    // 初始化连接线（在第一帧）
    if (!isInitialized.current && connectionCount > 0) {
      isInitialized.current = true;
      const initialConnections: ConnectionState[] = [];

      for (let i = 0; i < connectionCount; i++) {
        // 给初始连接线随机的起始时间，制造交错效果
        const connection = generateRandomConnection(time - Math.random() * 2);
        if (connection) {
          initialConnections.push(connection);
        }
      }

      setConnections(initialConnections);
      lastUpdateTime.current = time;
      return;
    }

    // 定期检查
    if (time - lastUpdateTime.current > CONFIG.UPDATE_INTERVAL) {
      lastUpdateTime.current = time;

      setConnections((prev) => {
        // 过滤掉已经过期的连接
        const active = prev.filter((conn) => time - conn.birthTime < conn.duration);

        // 如果连接数量不足，随机添加新连接
        const needed = connectionCount - active.length;
        if (
          needed > 0 && // 随机决定这次是否添加新连接
          Math.random() < CONFIG.SPAWN_PROBABILITY
        ) {
          const newConnection = generateRandomConnection(time);
          if (newConnection) {
            return [...active, newConnection];
          }
        }

        return active;
      });
    }

    // 自动旋转动画
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.001;
      groupRef.current.rotation.x += 0.0005;
    }
  });

  return (
    <group ref={groupRef} rotation={[0.3, 0.5, 0.1]}>
      {/* 中心用户头像 */}
      <CenterAvatar />

      {/* 渲染连线 */}
      {connections.map((connection, index) => (
        <ConnectionLine
          birthTime={connection.birthTime}
          duration={connection.duration}
          end={connection.end}
          index={index}
          key={connection.id}
          start={connection.start}
        />
      ))}
      {/* 渲染标签 */}
      {wordsData.map((word, index) => (
        <Word key={`word-${index}`} {...word} />
      ))}
    </group>
  );
});

interface TagCloudCanvasProps {
  tags: QueryTagsResult[];
}

const TagCloudCanvas = memo<TagCloudCanvasProps>(({ tags }) => {
  const theme = useTheme();

  if (!tags.length) return null;
  return (
    <Canvas camera={{ fov: 75, position: [0, 0, 35] }} dpr={[1, 2]}>
      <color args={[theme.colorBgContainer]} attach="background" />
      <fog args={[theme.colorBgLayout, 0, 80]} attach="fog" />
      <ambientLight intensity={0.5} />
      <pointLight intensity={1} position={[10, 10, 10]} />
      <Suspense fallback={null}>
        <Cloud radius={20} tags={tags} />
      </Suspense>
      <OrbitControls
        enableDamping
        autoRotate={false}
        dampingFactor={0.05}
        enablePan={false}
        maxDistance={50}
        minDistance={20}
        rotateSpeed={0.5}
      />
    </Canvas>
  );
});

export default TagCloudCanvas;
