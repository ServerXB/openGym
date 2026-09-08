#!/usr/bin/env node
// Deterministic property check for Requirement 7's bounded load solver.
// Vite's SSR loader is used because the production module shares browser-side dependencies.

import { createServer } from 'vite'

const CASES = 2000
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent'
})

try {
  const { solveBoundedLoad } = await server.ssrLoadModule('/src/lib/equipment-load.js')
  let seed = 73129
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

  for (let testCase = 0; testCase < CASES; testCase++) {
    const denominationCount = 1 + Math.floor(random() * 5)
    const usedWeights = new Set()
    const denominations = []
    while (denominations.length < denominationCount) {
      const units = 25 * (1 + Math.floor(random() * 120))
      if (usedWeights.has(units)) continue
      usedWeights.add(units)
      denominations.push({
        weight: units / 100,
        count: 1 + Math.floor(random() * 4)
      })
    }

    const target = Math.floor(random() * 15000)
    let sums = new Set([0])
    for (const denomination of denominations) {
      const prior = [...sums]
      const next = new Set(sums)
      const units = Math.round(denomination.weight * 100)
      for (const sum of prior) {
        for (let count = 1; count <= denomination.count; count++) {
          next.add(sum + count * units)
        }
      }
      sums = next
    }

    const ordered = [...sums].sort((a, b) => a - b)
    const expected = [
      sums.has(target) ? target : null,
      [...ordered].reverse().find(value => value <= target) ?? null,
      ordered.find(value => value >= target) ?? null
    ]
    const result = solveBoundedLoad(denominations, target)
    const actual = [
      result.exact?.units ?? null,
      result.lower?.units ?? null,
      result.upper?.units ?? null
    ]

    if (actual.some((value, index) => value !== expected[index])) {
      throw new Error(JSON.stringify({ testCase, denominations, target, expected, actual, result }))
    }
  }

  console.log(`${CASES} deterministic brute-force solver comparisons passed`)
} finally {
  await server.close()
}
