import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../shared/authStore';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import DashboardPage from '../pages/DashboardPage';
import ProjectPage from '../pages/ProjectPage';
import LoadingScreen from '../components/LoadingScreen';

export default function App() {
  const { init, isAuthenticated, isLoading, user } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  // Show splash while checking auth
  if (isLoading && !user) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      {/* Auth routes — redirect to dashboard if already logged in */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to="/" /> : <RegisterPage />} />

      {/* Protected routes */}
      <Route path="/projects/:id" element={isAuthenticated ? <ProjectPage /> : <Navigate to="/login" />} />
      <Route path="/*" element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />} />
    </Routes>
  );
}
