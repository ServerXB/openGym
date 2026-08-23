import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Stepper } from './ui.jsx'

describe('Stepper accessibility', () => {
  it('associates its visible label with the numeric input and names both actions', () => {
    const html = renderToStaticMarkup(
      <Stepper label="Minimum reps" value={8} step={1} decimal={false} onChange={() => {}} />
    )

    const labelFor = html.match(/<label[^>]*for="([^"]+)"/)?.[1]
    expect(labelFor).toBeTruthy()
    expect(html).toContain(`id="${labelFor}"`)
    expect(html).toContain('aria-label="Decrease Minimum reps"')
    expect(html).toContain('aria-label="Increase Minimum reps"')
  })

  it('uses the supplied accessible name when there is no visible label', () => {
    const html = renderToStaticMarkup(
      <Stepper ariaLabel="Working weight" unit="kg" value={70} step={2} onChange={() => {}} />
    )

    expect(html).toContain('aria-label="Working weight (kg)"')
    expect(html).toContain('aria-label="Decrease Working weight (kg)"')
    expect(html).toContain('aria-label="Increase Working weight (kg)"')
    expect(html).toContain('<i aria-hidden="true">kg</i>')
  })

  it('links invalid input to its explicit validation message', () => {
    const html = renderToStaticMarkup(
      <Stepper label="Increment" value={2} step={0.25} invalid describedBy="increment-error"
        onChange={() => {}} />
    )

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="increment-error"')
  })
})
