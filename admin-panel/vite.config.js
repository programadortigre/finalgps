import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 80,
        proxy: {
            '/api': {
                target: 'http://api:3000',
                changeOrigin: true
            },
            '/socket.io': {
                target: 'http://api:3000',
                ws: true
            }
        }
    }
})
