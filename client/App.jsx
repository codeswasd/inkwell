import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import DocumentPage from './components/DocumentPage.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { DialogProvider } from './components/Dialog.jsx';

const parseRoute = () => {
  const m = window.location.hash.match(/^#\/doc\/([A-Za-z0-9_-]+)/);
  return m ? { name: 'doc', id: m[1] } : { name: 'home' };
};

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(getToken()));
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* token may already be gone */ }
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('inkwell:unauthorized', onUnauthorized);
    if (getToken()) {
      api.me().then(setUser).catch(() => setToken(null)).finally(() => setBooting(false));
    }
    return () => window.removeEventListener('inkwell:unauthorized', onUnauthorized);
  }, []);

  const onLogin = ({ token, user }) => {
    setToken(token);
    setUser(user);
  };

  let page;
  if (booting) page = <div className="boot"><span className="spinner" /></div>;
  else if (!user) page = <Login onLogin={onLogin} />;
  else if (route.name === 'doc') page = <DocumentPage key={`${route.id}-${user.id}`} id={route.id} user={user} onSignOut={signOut} />;
  else page = <Home user={user} onSignOut={signOut} />;

  return <ToastProvider><DialogProvider>{page}</DialogProvider></ToastProvider>;
}
