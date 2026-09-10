import { ImageResponse } from 'next/og';

export const alt = 'Plurilog — Your Own AI Panel';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          backgroundColor: '#FBF9F5',
          padding: '80px 100px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand Top */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: '#FEF3C7',
              border: '1px solid #FDE68A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 700,
              color: '#78350F',
            }}
          >
            P
          </div>
          <span
            style={{
              fontSize: '32px',
              fontWeight: 700,
              color: '#18181B',
              letterSpacing: '-0.02em',
            }}
          >
            Plurilog
          </span>
        </div>

        {/* Main Content Middle */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            maxWidth: '1000px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderRadius: '9999px',
              padding: '8px 20px',
              width: 'fit-content',
            }}
          >
            <span
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: '#78350F',
              }}
            >
              The Best AIs. One Room.
            </span>
          </div>

          <h1
            style={{
              fontSize: '72px',
              fontWeight: 800,
              color: '#18181B',
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              margin: 0,
            }}
          >
            Your Own AI Panel
          </h1>

          <p
            style={{
              fontSize: '28px',
              color: '#71717A',
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            ChatGPT, Claude & Gemini in one ongoing AI discussion.
          </p>
        </div>

        {/* Bottom Accent */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            borderTop: '1px solid #E4E4E7',
            paddingTop: '32px',
          }}
        >
          <span
            style={{
              fontSize: '20px',
              color: '#A1A1AA',
              fontWeight: 500,
            }}
          >
            plurilogai.com
          </span>
          <span
            style={{
              fontSize: '20px',
              color: '#D97706',
              fontWeight: 600,
            }}
          >
            Shared Context · Multi-Perspective · File Uploads
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
