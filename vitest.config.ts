export default {
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/studio/Studio.ts",
        "src/studio/InstrumentLearning.ts",
        "src/studio/browserMetronome.ts",
        "src/studio/sessionInstrumentView.ts",
        "src/studio/studioPresentation.ts",
        "src/studio/studioSession.ts"
      ],
      thresholds: {
        branches: 60,
        functions: 75,
        lines: 75,
        statements: 75
      }
    }
  }
}
