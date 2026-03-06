import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase';
import { signAccessToken, signRefreshToken, verifyToken, JwtPayload } from '../utils/jwt';

const SALT_ROUNDS = 10;

/**
 * POST /api/auth/register
 * Body: { email, password, name, role? }
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'email, password, and name are required' });
      return;
    }

    // Check if user already exists (only active users)
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .eq('active_flag', 'Y')
      .single();

    if (existing) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email,
        password: hashedPassword,
        name,
        role: role === 'admin' ? 'admin' : 'user',
      })
      .select('id, email, name, role, created_at')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to create user', detail: error.message });
      return;
    }

    // Sign tokens
    const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
    const token = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    res.status(201).json({ token, refreshToken, user });
  } catch (err: any) {
    res.status(500).json({ error: 'Registration failed', detail: err.message });
  }
};

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    // Fetch user (only active users can log in)
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, password, created_at')
      .eq('email', email)
      .eq('active_flag', 'Y')
      .single();

    if (error || !user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Sign tokens
    const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
    const token = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // Return user without password hash
    const { password: _, ...safeUser } = user;
    res.json({ token, refreshToken, user: safeUser });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
};

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return;
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken);

    // Fetch latest user data (in case role changed; only active users)
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, role')
      .eq('id', decoded.userId)
      .eq('active_flag', 'Y')
      .single();

    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }

    const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
    const token = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    res.json({ token, refreshToken: newRefreshToken, user });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};


