import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="auth-bg flex min-h-[100dvh] items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/70 bg-card/90 p-8 text-center shadow-pop backdrop-blur-xl">
        <h1 className="mb-2 font-head text-6xl font-bold tracking-[-0.05em] text-foreground">404</h1>
        <p className="mb-6 text-muted-foreground">Упс! Страница не найдена</p>
        <a href="/" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98]">
          Вернуться на главную
        </a>
      </div>
    </div>
  );
};

export default NotFound;
