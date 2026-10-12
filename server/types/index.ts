/**
 * Shared type definitions for the Secret Santa server
 */

// API Response types

export interface UserResponse {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  hasSeenReveal: boolean;
  createdAt?: string;
}

export interface LoginResponse {
  user: UserResponse;
}

export interface CreateUserResponse {
  user: UserResponse;
  password: string;
}

export interface MatchResponse {
  firstTime: boolean;
  recipient: {
    id: number;
    name: string;
    email: string;
  };
}

export interface WishlistItemResponse {
  id: number;
  url: string | null;
  description: string | null;
  title: string | null;
  imageUrl: string | null;
  price: string | null;
  addedAt: string;
}

export interface WishlistResponse {
  items: WishlistItemResponse[];
}

export interface MatchPair {
  id: number;
  giver: {
    id: number;
    name: string;
    email: string;
  };
  receiver: {
    id: number;
    name: string;
    email: string;
  };
}

export interface MatchesResponse {
  year: number;
  matches: MatchPair[];
}

// Request body types

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  isAdmin?: boolean;
}

export interface AddWishlistItemRequest {
  url?: string;
  description?: string;
}

// Error response type
export interface ErrorResponse {
  error: string;
}
