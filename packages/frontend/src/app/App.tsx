import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../shared/authStore';
import LandingPage from '../pages/LandingPage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import DashboardPage from '../pages/DashboardPage';
import AccountPage from '../pages/AccountPage';
import AdminPage from '../pages/AdminPage';
import AdminViewPage from '../pages/AdminViewPage';
import ProjectPage from '../pages/ProjectPage';
import SharedViewerPage from '../pages/SharedViewerPage';
import PublicProjectPage from '../pages/PublicProjectPage';
import InvitePage from '../pages/InvitePage';
import VerifyEmailPage from '../pages/VerifyEmailPage';
import ForgotPasswordPage from '../pages/ForgotPasswordPage';
import ResetPasswordPage from '../pages/ResetPasswordPage';
import OAuthCallbackPage from '../pages/OAuthCallbackPage';
import LoadingScreen from '../components/LoadingScreen';
import ThemeToggle from '../components/ThemeToggle';
import { GuestOnly, RequireAuth } from '../pages/auth/guards';

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
    <>
      {/* Переключатель темы — поверх всех страниц */}
      <ThemeToggle />
      <Routes>
        {/* Public share link — no registration required */}
        <Route path="/share/:token" element={<SharedViewerPage />} />

        {/* Открытый проект. Короткий адрес — чтобы его можно было продиктовать,
            а не пересылать; доступ решает флаг публичности на сервере */}
        <Route path="/p/:id" element={<PublicProjectPage />} />

        {/* Invite link — регистрация/вход прямо на странице приглашения */}
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* Ссылки из писем. Вход не требуется и не мешает: доказательством
            служит сам токен, а письмо часто открывают на другом устройстве */}
        <Route path="/verify/:token" element={<VerifyEmailPage />} />
        <Route path="/reset/:token" element={<ResetPasswordPage />} />
        {/* Возврат из Яндекса / Google / VK / Facebook / WeChat. Токен в query,
            страница сама его съест и вычистит из адресной строки. */}
        <Route path="/auth/oauth" element={<OAuthCallbackPage />} />

        {/* Уже вошедшего возвращаем на next (приглашение), а не всегда на корень */}
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="/forgot" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />

        {/* Корень: залогиненным — дашборд, гостям — публичный лендинг */}
        <Route path="/" element={isAuthenticated ? <DashboardPage /> : <LandingPage />} />

        {/* Protected routes */}
        <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
        {/* Админка. Гостю — на вход, а не «не найдено»: страница сама решит,
            что показать хозяину, а что всем остальным */}
        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        {/* Тихий просмотр. До catch-all, иначе /* заберёт /admin/view/:id.
            Пропуск из sessionStorage жив только в этой вкладке — новая
            вкладка спросила бы код заново */}
        <Route path="/admin/view/:id" element={<RequireAuth><AdminViewPage /></RequireAuth>} />
        <Route path="/projects/:id" element={<RequireAuth><ProjectPage /></RequireAuth>} />
        <Route
          path="/*"
          element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />}
        />
      </Routes>
    </>
  );
}
