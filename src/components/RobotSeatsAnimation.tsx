'use client';

import React, { useEffect, useRef, useState } from 'react';

type RobotId = 'gpt' | 'claude' | 'gemini';

const ROBOTS: Record<RobotId, string> = {
  gpt: '/robot-head-chatgpt.svg',
  claude: '/robot-head-claude.svg',
  gemini: '/robot-head-gemini.svg',
};

const INK = '#1C1B1A';
const CORAL = '#E0644B';
const LOOP_SECONDS = 6.2;
const BASE_WIDTH = 392;
const BASE_HEIGHT = 150;
const SLOTS = [52, 158, 264];
const ORDER_0: RobotId[] = ['gpt', 'claude', 'gemini'];
const ORDER_1: RobotId[] = ['claude', 'gpt', 'gemini'];
const ORDER_2: RobotId[] = ['gemini', 'gpt', 'claude'];

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const progress = (time: number, start: number, end: number) =>
  clamp((time - start) / (end - start));
const easeInOut = (value: number) =>
  value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;

function frameAt(time: number) {
  let from = ORDER_0;
  let to = ORDER_0;
  let movement = 0;

  if (time >= 0.5 && time < 1.1) {
    from = ORDER_0;
    to = ORDER_1;
    movement = easeInOut(progress(time, 0.5, 1.1));
  } else if (time >= 1.1 && time < 3.2) {
    from = ORDER_1;
    to = ORDER_1;
  } else if (time >= 3.2 && time < 3.8) {
    from = ORDER_1;
    to = ORDER_2;
    movement = easeInOut(progress(time, 3.2, 3.8));
  } else if (time >= 3.8 && time < 4.0) {
    from = ORDER_2;
    to = ORDER_2;
  } else if (time >= 4.0 && time < 4.6) {
    from = ORDER_2;
    to = ORDER_0;
    movement = easeInOut(progress(time, 4.0, 4.6));
  }

  const xVisible = time >= 1.3 && time < 3.0;
  const firstStroke = progress(time, 1.3, 1.5);
  const secondStroke = progress(time, 1.45, 1.65);
  const greyAmount =
    easeInOut(progress(time, 1.45, 1.8)) *
    (1 - easeInOut(progress(time, 2.6, 3.0)));
  const xOpacity = 1 - progress(time, 2.6, 2.85);

  const currentOrder = movement < 0.5 ? from : to;
  let seatNumber = 0;
  const badges: Partial<Record<RobotId, string>> = {};

  currentOrder.forEach((id) => {
    if (id === 'claude' && greyAmount > 0.5) {
      badges[id] = 'off';
    } else {
      seatNumber += 1;
      badges[id] = String(seatNumber);
    }
  });

  return (['gpt', 'claude', 'gemini'] as RobotId[]).map((id) => {
    const fromIndex = from.indexOf(id);
    const toIndex = to.indexOf(id);
    const direction = Math.sign(fromIndex - toIndex) * -1;
    const arc =
      Math.sin(movement * Math.PI) *
      (direction === 0 ? 0 : direction < 0 ? -26 : 14);
    const grey = id === 'claude' ? greyAmount : 0;

    return {
      id,
      badge: badges[id] || '',
      x:
        SLOTS[fromIndex] +
        (SLOTS[toIndex] - SLOTS[fromIndex]) * movement,
      y: 20 + arc + Math.sin(time * 3 + fromIndex) * 2 + grey * 8,
      rotation: direction * Math.sin(movement * Math.PI) * 10,
      grey,
      firstStrokeOffset:
        id === 'claude' && xVisible ? 1 - firstStroke : 1,
      secondStrokeOffset:
        id === 'claude' && xVisible ? 1 - secondStroke : 1,
      xOpacity: id === 'claude' && xVisible ? xOpacity : 0,
    };
  });
}

export function RobotSeatsAnimation() {
  const [time, setTime] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const updateScale = () => {
      const width = panel.getBoundingClientRect().width;
      if (width > 0) {
        setScale(width / BASE_WIDTH);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(panel);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (reduceMotion) {
      setTime(0);
      return;
    }

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      setTime(((now - startRef.current) / 1000) % LOOP_SECONDS);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const robots = frameAt(time);

  return (
    <div
      ref={panelRef}
      aria-hidden="true"
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        aspectRatio: `${BASE_WIDTH} / ${BASE_HEIGHT}`,
        backgroundColor: '#F7F3EA',
        backgroundImage:
          'linear-gradient(rgba(28,27,26,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(28,27,26,.05) 1px, transparent 1px)',
        backgroundSize: `${24 * scale}px ${24 * scale}px`,
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {robots.map((robot) => (
          <div
            key={robot.id}
            className="absolute flex w-[84px] flex-col items-center gap-2"
            style={{
              left: robot.x,
              top: robot.y,
            }}
          >
            <div className="relative h-[72px] w-[76px]">
              <img
                src={ROBOTS[robot.id]}
                alt=""
                draggable={false}
                className="h-[72px] w-[76px] select-none object-contain"
                style={{
                  filter: `grayscale(${robot.grey})`,
                  opacity: 1 - robot.grey * 0.5,
                  transform: `rotate(${robot.rotation}deg)`,
                }}
              />
              <svg
                width="76"
                height="72"
                viewBox="0 0 76 72"
                className="absolute inset-0 overflow-visible"
              >
                <path
                  d="M14 14 L62 58"
                  fill="none"
                  stroke={CORAL}
                  strokeWidth="7"
                  strokeLinecap="round"
                  pathLength="1"
                  strokeDasharray="1"
                  strokeDashoffset={robot.firstStrokeOffset}
                  opacity={robot.xOpacity}
                />
                <path
                  d="M62 14 L14 58"
                  fill="none"
                  stroke={CORAL}
                  strokeWidth="7"
                  strokeLinecap="round"
                  pathLength="1"
                  strokeDasharray="1"
                  strokeDashoffset={robot.secondStrokeOffset}
                  opacity={robot.xOpacity}
                />
              </svg>
            </div>

            <span
              className="flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-2 text-[13px] font-semibold"
              style={{
                background: robot.badge === 'off' ? '#ECEAE5' : INK,
                color: robot.badge === 'off' ? '#6A675F' : '#FFFFFF',
              }}
            >
              {robot.badge}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
