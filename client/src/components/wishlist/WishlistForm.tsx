import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { NewWishlistItem } from '@/types';

interface WishlistFormProps {
  onAdd: (input: NewWishlistItem) => Promise<void>;
}

export function WishlistForm({ onAdd }: WishlistFormProps) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasInput = url.trim() !== '' || description.trim() !== '';

  const validate = (): boolean => {
    if (!hasInput) {
      setError('Enter a link or a description');
      return false;
    }
    if (url.trim()) {
      try {
        const { protocol } = new URL(url.trim());
        if (protocol !== 'http:' && protocol !== 'https:') {
          setError('Link must start with http:// or https://');
          return false;
        }
      } catch {
        setError('Please enter a valid link');
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validate()) return;

    setLoading(true);
    try {
      await onAdd({
        url: url.trim() || undefined,
        description: description.trim() || undefined,
      });
      setUrl('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item to wishlist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-[#e5e0d8]">
      <CardHeader>
        <CardTitle className="text-xl text-gray-900">Add Wishlist Item</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-url">Link (optional)</Label>
            <Input
              id="item-url"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className="border-gray-300 focus-visible:ring-[#1a472a]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-description">Description (optional)</Label>
            <textarea
              id="item-description"
              rows={3}
              maxLength={500}
              placeholder="e.g. A medium blue scarf, any brand"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a472a] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-sm text-gray-500">
              Add a link, a description, or both. At least one is required.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={loading || !hasInput}
            className="w-full bg-[#1a472a] hover:bg-[#1a472a]/90 text-white"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Adding Item...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Add to Wishlist
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
