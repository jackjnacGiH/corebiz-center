import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';
import { signInWithEmail, signInWithGoogle, signInWithLine } from '../../lib/auth';
import { useLanguage } from '../../i18n';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, language, setLanguage } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'inactive'
      ? t.auth.inactiveAccount
      : null
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithEmail(email, password);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate('/');
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err.message);
  };

  const handleLine = () => {
    try {
      setError(null);
      signInWithLine();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 text-neutral-900 px-4 py-16">
      <div className="w-full max-w-md space-y-12">
        {/* Language toggle */}
        <div className="flex justify-end">
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-xs font-semibold shadow-xs">
            <button
              type="button"
              onClick={() => setLanguage('th')}
              className={`px-3.5 py-1.5 rounded-md transition ${
                language === 'th'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              TH
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`px-3.5 py-1.5 rounded-md transition ${
                language === 'en'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              EN
            </button>
          </div>
        </div>

        {/* Logo / title */}
        <div className="text-center space-y-4">
          <div className="text-3xl font-bold tracking-tight text-neutral-900">
            CoreBiz Center
          </div>
          <p className="text-sm text-neutral-500">{t.auth.subtitle}</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-10 space-y-9">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-7">
            <div className="space-y-3">
              <label htmlFor="email" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                {t.auth.emailLabel}
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 bg-neutral-50 border border-neutral-200 rounded-lg pl-12 pr-4 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
                  placeholder="you@corebiz.online"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor="password" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                {t.auth.passwordLabel}
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 bg-neutral-50 border border-neutral-200 rounded-lg pl-12 pr-4 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed transition shadow-sm"
            >
              <LogIn size={16} />
              {loading ? t.auth.signingIn : t.auth.signIn}
            </button>
          </form>

          {/* Divider */}
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-4 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                {t.auth.orContinueWith}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={handleGoogle}
              className="h-12 flex items-center justify-center gap-2.5 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 transition"
            >
              <GoogleIcon /> Google
            </button>
            <button
              type="button"
              onClick={handleLine}
              className="h-12 flex items-center justify-center gap-2.5 rounded-lg bg-[#06C755] text-sm font-medium text-white hover:bg-[#05b34a] transition shadow-sm"
            >
              <LineIcon /> LINE
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-neutral-500 leading-relaxed pt-2">
          {t.auth.adminOnly}
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#EA4335" d="M12 5c1.617 0 3.077.557 4.222 1.65l3.146-3.146C17.45 1.65 14.93.5 12 .5 7.39.5 3.4 3.14 1.39 7l3.7 2.87C6.07 6.85 8.8 5 12 5z"/>
      <path fill="#4285F4" d="M23.5 12.275c0-.853-.077-1.673-.22-2.461H12v4.652h6.46c-.28 1.5-1.12 2.77-2.38 3.62l3.66 2.84c2.14-1.97 3.36-4.87 3.36-8.65z"/>
      <path fill="#FBBC05" d="M5.09 14.13a7.21 7.21 0 010-4.26L1.39 7C.5 8.77 0 10.83 0 13s.5 4.23 1.39 6l3.7-2.87z"/>
      <path fill="#34A853" d="M12 23.5c3.24 0 5.96-1.07 7.94-2.91l-3.66-2.84c-1.02.69-2.34 1.09-4.28 1.09-3.2 0-5.93-1.85-6.91-4.42l-3.7 2.87C3.4 20.86 7.39 23.5 12 23.5z"/>
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
    </svg>
  );
}
