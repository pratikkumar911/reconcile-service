import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const fetchMe = useCallback(async () => {
    const token = localStorage.getItem("recon_token");
    if (!token) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      localStorage.removeItem("recon_token");
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("recon_token", data.token);
    setUser(data.user);
    return data.user;
  };

  const signup = async (email, password) => {
    const { data } = await api.post("/auth/signup", { email, password });
    localStorage.setItem("recon_token", data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("recon_token");
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, ready, login, signup, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
