import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { ToastProvider } from './ToastContext';
import TabLock from './components/TabLock';
import Dashboard from './components/Dashboard';
import Register from './components/Register';
import Login from './components/Login';

function AppRoutes() {
  const { user, encryptionKey } = useAuth();

  return (
    <Routes>
      <Route
        path="/"
        element={user && encryptionKey ? <Dashboard /> : <Navigate to="/login" />}
      />
      <Route
        path="/login"
        element={!(user && encryptionKey) ? <Login /> : <Navigate to="/" />}
      />
      <Route
        path="/register"
        element={!user ? <Register /> : <Navigate to="/" />}
      />
    </Routes>
  );
}

function App() {
  return (
    <ToastProvider>
      <TabLock>
        <AuthProvider>
          <Router>
            <AppRoutes />
          </Router>
        </AuthProvider>
      </TabLock>
    </ToastProvider>
  );
}

export default App;