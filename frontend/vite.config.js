import { readFile } from 'node:fs/promises'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const browserModel = {
  name: 'genome-x-browser-model',
  async generateBundle() {
    const path = new URL('../node-backend/model/genome-x.onnx', import.meta.url)
    try {
      this.emitFile({ type: 'asset', fileName: 'model/genome-x.onnx', source: await readFile(path) })
    } catch {
      this.error('Build the ONNX checkpoint with python node-backend/export_model.py before running build:browser.')
    }
  },
}

export default defineConfig(({ mode }) => ({
  plugins: mode === 'browser' ? [react(), browserModel] : [react()],
  worker: { format: 'es' },
}))
