import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { Toaster } from './lib'

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <Toaster />
  </>,
)
