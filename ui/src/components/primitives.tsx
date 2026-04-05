import React, {type PropsWithChildren, type ReactNode} from 'react'

import type {UiTone} from '../../../src/lib/ui/contracts'

const TONE_STYLES: Record<UiTone, string> = {
  fail: 'border-[color:var(--fail)]/40 bg-[color:var(--fail)]/10 text-[color:var(--fail)]',
  info: 'border-[color:var(--info)]/35 bg-[color:var(--info)]/10 text-[color:var(--info)]',
  pass: 'border-[color:var(--pass)]/35 bg-[color:var(--pass)]/10 text-[color:var(--pass)]',
  skip: 'border-[color:var(--skip)]/35 bg-[color:var(--skip)]/10 text-[color:var(--skip)]',
  warn: 'border-[color:var(--warn)]/35 bg-[color:var(--warn)]/10 text-[color:var(--warn)]',
}

export function Card(props: PropsWithChildren<{className?: string; title?: string; tone?: UiTone}>) {
  return (
    <section className={`ui-card ${props.className ?? ''}`}>
      {props.title ? (
        <header className="border-b border-white/5 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{props.title}</h2>
            {props.tone ? <TonePill tone={props.tone}>{props.tone}</TonePill> : null}
          </div>
        </header>
      ) : null}
      <div className="p-5">{props.children}</div>
    </section>
  )
}

export function TonePill(props: PropsWithChildren<{tone: UiTone}>) {
  return (
    <span className={`ui-pill ${TONE_STYLES[props.tone]}`}>
      <span className="inline-block h-2 w-2 rounded-full bg-current" />
      {props.children}
    </span>
  )
}

export function SectionTitle(props: {action?: ReactNode; eyebrow?: string; title: string}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {props.eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-soft)]">{props.eyebrow}</p>
        ) : null}
        <h3 className="mt-2 text-lg font-semibold">{props.title}</h3>
      </div>
      {props.action}
    </div>
  )
}

export function EmptyState(props: {body: string; title: string}) {
  return (
    <div className="ui-card-soft rounded-3xl p-5 text-sm text-[var(--text-muted)]">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">{props.title}</p>
      <p className="mt-3 leading-6">{props.body}</p>
    </div>
  )
}

export function JsonPanel(props: {value: unknown}) {
  return (
    <details className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Raw JSON
      </summary>
      <pre className="mt-4 overflow-x-auto text-xs leading-6 text-[var(--signal)]">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </details>
  )
}
