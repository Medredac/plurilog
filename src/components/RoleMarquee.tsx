import React from 'react';

const roles = [
  'Students',
  'Teachers',
  'Researchers',
  'Writers',
  'Developers',
  'Designers',
  'Freelancers',
  'Job Seekers',
  'Creators',
  'Founders',
  'Analysts',
  'Consultants',
  'Marketers',
  'Managers',
  'Learners',
];

export function RoleMarquee() {
  return (
    <div
      className="
        w-full overflow-hidden
        [mask-image:linear-gradient(to_right,transparent_0%,black_12%,black_88%,transparent_100%)]
        [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_12%,black_88%,transparent_100%)]
      "
    >
      <div className="role-marquee-track flex w-max whitespace-nowrap select-none pointer-events-none">
        <div className="flex shrink-0 items-center gap-7 sm:gap-9 pr-7 sm:pr-9">
          {roles.map((role, idx) => (
            <span
              key={`role-1-${idx}`}
              className="text-xs sm:text-sm font-medium text-zinc-400"
            >
              {role}
            </span>
          ))}
        </div>

        <div
          className="flex shrink-0 items-center gap-7 sm:gap-9 pr-7 sm:pr-9"
          aria-hidden="true"
        >
          {roles.map((role, idx) => (
            <span
              key={`role-2-${idx}`}
              className="text-xs sm:text-sm font-medium text-zinc-400"
            >
              {role}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
