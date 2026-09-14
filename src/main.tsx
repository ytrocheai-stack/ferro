import { ClerkProvider } from '@clerk/react'
/* eslint-disable react-refresh/only-export-components -- route-level lazy modules intentionally live here. */
import { lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import { applyTheme, readThemePreference } from './lib/theme'

// El estado persistido se resuelve antes de montar React para que la primera pintura
// use la apariencia elegida y no revele un flash de tema incorrecto.
applyTheme(readThemePreference())

// Code-splitting por página: recharts y las vistas pesadas salen del bundle inicial
const Home = lazy(() => import('./pages/Home'))
const RoutineEditor = lazy(() => import('./pages/RoutineEditor'))
const ActiveWorkoutPage = lazy(() => import('./pages/ActiveWorkoutPage'))
const History = lazy(() => import('./pages/History'))
const WorkoutDetail = lazy(() => import('./pages/WorkoutDetail'))
const Exercises = lazy(() => import('./pages/Exercises'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))
const Profile = lazy(() => import('./pages/Profile'))
const Nutrition = lazy(() => import('./pages/Nutrition'))
const Measurements = lazy(() => import('./pages/Measurements'))
const Analysis = lazy(() => import('./pages/Analysis'))
const CoachPage = lazy(() => import('./pages/CoachPage'))

const router = createBrowserRouter(
  [
    {
      element: <App />,
      children: [
        { path: '/', element: <Home /> },
        { path: '/rutina/:id', element: <RoutineEditor /> },
        { path: '/entreno', element: <ActiveWorkoutPage /> },
        { path: '/historial', element: <History /> },
        { path: '/historial/:id', element: <WorkoutDetail /> },
        { path: '/ejercicios', element: <Exercises /> },
        { path: '/ejercicios/:id', element: <ExerciseDetail /> },
        { path: '/nutricion', element: <Nutrition /> },
        { path: '/medidas', element: <Measurements /> },
        { path: '/analisis', element: <Analysis /> },
        { path: '/coach', element: <CoachPage /> },
        { path: '/perfil', element: <Profile /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider afterSignOutUrl="/">
      <RouterProvider router={router} />
    </ClerkProvider>
  </StrictMode>,
)
