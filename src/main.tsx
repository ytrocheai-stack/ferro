import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import Home from './pages/Home'
import RoutineEditor from './pages/RoutineEditor'
import ActiveWorkoutPage from './pages/ActiveWorkoutPage'
import History from './pages/History'
import WorkoutDetail from './pages/WorkoutDetail'
import Exercises from './pages/Exercises'
import ExerciseDetail from './pages/ExerciseDetail'
import Profile from './pages/Profile'

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
        { path: '/perfil', element: <Profile /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
