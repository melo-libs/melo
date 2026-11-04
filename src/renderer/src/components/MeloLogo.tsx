import type { SVGProps } from 'react'
import { cn } from '../lib/cn'
import './melo-logo.scss'

type Mood = 'brand' | 'idle' | 'hover' | 'working' | 'waiting' | 'ready' | 'error' | 'offline'

/** The static brand mark remains the default outside Agent entry points. */
export function MeloLogo({
  size = 22,
  mood = 'brand',
  className,
  ...rest
}: { size?: number; mood?: Mood } & SVGProps<SVGSVGElement>) {
  const sleeping = mood === 'idle' || mood === 'offline'
  const smiling = mood === 'hover' || mood === 'ready'
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn('melo-mascot', className)}
      data-mood={mood}
      data-small={size <= 18 || undefined}
      {...rest}
    >
      {mood === 'working' && (
        <g
          className="melo-wake"
          fill="none"
          stroke="var(--ink-4)"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 21h6M2 29h5M3 45h6" />
        </g>
      )}
      <g className="melo-fish">
        {mood === 'waiting' && (
          <g fill="var(--melo-fin)">
            <circle cx="24" cy="17" r="1.8" />
            <circle cx="31" cy="14" r="1.8" />
            <circle cx="38" cy="14" r="1.8" />
            <circle cx="45" cy="17" r="1.8" />
          </g>
        )}
        <path
          d="M54.25,29.31A2.37,2.37,0,0,0,53,24.74a1.62,1.62,0,0,1-1.8-.84A18.07,18.07,0,0,0,17,32.09a1,1,0,0,1-1,1l-6.35-.44a1.48,1.48,0,0,0-1.54,1.86L9.89,41.4a1.49,1.49,0,0,0,2.26.85l5-3.39a.84.84,0,0,1,1.3.4,18.05,18.05,0,0,0,5.44,7Z"
          fill="var(--melo-body)"
        />
        <path
          d="M54.25,29.31l-12.4,3.32-6.53,1.88C30.06,36.43,24.57,40,23.94,46.25A18.07,18.07,0,0,0,53.11,30.94,1.61,1.61,0,0,1,54.25,29.31Z"
          fill="var(--melo-belly)"
        />
        {sleeping ? (
          <path
            className="melo-sleep-eye"
            d="M41 22q3 3 5 0"
            fill="none"
            stroke="var(--melo-eye)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : mood === 'waiting' ? (
          <g>
            <circle
              cx="44"
              cy="22"
              r="3.5"
              fill="var(--melo-belly)"
              stroke="var(--melo-eye)"
              strokeWidth="1"
            />
            <circle cx="44.5" cy="22" r="2" fill="var(--melo-eye)" />
            <circle cx="45" cy="21" r="0.8" fill="var(--melo-belly)" />
          </g>
        ) : mood === 'error' ? (
          <path
            d="m41 20 5 5m0-5-5 5"
            fill="none"
            stroke="var(--melo-eye)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : smiling ? (
          <path
            d="M41 23q2-4 5-1"
            fill="none"
            stroke="var(--melo-eye)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <g fill="var(--melo-eye)">
            <path d="M41.43,23.34a2,2,0,1,0,1.4-2.42A2,2,0,0,0,41.43,23.34Z" />
            {mood === 'working' && (
              <path d="m40 19 6 2" stroke="var(--melo-eye)" strokeWidth="2" strokeLinecap="round" />
            )}
          </g>
        )}
        {mood === 'idle' && (
          <g className="melo-greeting">
            <path
              d="M41 23q2-4 5-1"
              fill="none"
              stroke="var(--melo-eye)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <ellipse cx="47" cy="27" rx="2" ry="1" fill="var(--melo-fin)" />
          </g>
        )}
        {smiling && <ellipse cx="47" cy="27" rx="2" ry="1" fill="var(--melo-fin)" />}
        <path
          d="M34.268 33.564C34.824 35.674 36.992 36.926 39.098 36.354C40.338 36.024 41.718 34.214 42.628 32.804C43.244 31.843 42.902 30.56 41.888 30.034C40.398 29.264 38.298 28.384 37.058 28.724C34.94 29.276 33.683 31.455 34.268 33.564Z"
          fill="var(--melo-fin)"
        />
      </g>
      {sleeping && (
        <g
          className="melo-sleep"
          fill="none"
          stroke="var(--ink-4)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M51 10h5l-5 5h5M58 4h3l-3 3h3" />
        </g>
      )}
      {mood === 'ready' && (
        <g className="melo-stars" fill="var(--melo-fin)">
          <path d="m55 8 1.5 4.5L61 14l-4.5 1.5L55 20l-1.5-4.5L49 14l4.5-1.5Z" />
          <path d="m60 25 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" />
        </g>
      )}
      {mood === 'waiting' && (
        <g className="melo-thought" fill="var(--paper)" stroke="var(--melo-fin)" strokeWidth="1">
          <circle cx="53" cy="19" r="1.2" />
          <circle cx="57" cy="13" r="1.8" />
          <circle cx="59" cy="6" r="2.5" />
        </g>
      )}
      {mood === 'error' && (
        <g
          className="melo-error"
          fill="none"
          stroke="var(--danger)"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M55 10a3 3 0 1 0 3 3M55 8v3" />
          <circle cx="62" cy="17" r="0.8" fill="var(--danger)" stroke="none" />
        </g>
      )}
    </svg>
  )
}
