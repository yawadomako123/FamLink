'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, Pencil } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { api, ApiClientError, errorMessage } from '@/lib/api/client';
import { nameSchema } from '@/lib/validation/auth';

export function ProfileIdentity({
  userId,
  name: initialName,
  email,
  image: initialImage,
  uploadsEnabled,
}: {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [name, setName] = React.useState(initialName);
  const [image, setImage] = React.useState(initialImage);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = nameSchema.safeParse(new FormData(event.currentTarget).get('name'));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter your name.');
      return;
    }

    setSaving(true);
    try {
      await api.patch('/api/v1/profile', { name: parsed.data });
      setName(parsed.data);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setError(null);
    setUploading(true);

    const body = new FormData();
    body.append('file', file);

    try {
      // Not api.post: FormData must set its own multipart boundary, which the
      // JSON client would overwrite with application/json.
      const response = await fetch('/api/v1/profile/avatar', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });

      const payload = (await response.json()) as
        | { data: { image: string } }
        | { error: { code: string; message: string } };

      if (!response.ok || 'error' in payload) {
        throw new ApiClientError(
          response.status,
          'error' in payload ? payload.error.code : 'UNKNOWN',
          'error' in payload ? payload.error.message : 'Upload failed.',
        );
      }

      setImage(payload.data.image);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardContent className="pt-5">
        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}

        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar name={name} userId={userId} image={image} size="xl" />

            {uploadsEnabled && (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Change profile photo"
                  className="absolute -bottom-1 -right-1 size-8 rounded-full bg-card border border-line-strong shadow-soft flex items-center justify-center text-muted hover:text-fg transition-colors disabled:opacity-60"
                >
                  <Camera aria-hidden className="size-4" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadAvatar(file);
                  }}
                />
              </>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {editing ? (
              <form onSubmit={saveName} className="flex items-center gap-2">
                <Input
                  name="name"
                  defaultValue={name}
                  aria-label="Your name"
                  autoFocus
                  maxLength={60}
                  className="h-9"
                />
                <Button type="submit" size="sm" loading={saving}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-fg truncate">{name}</p>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Edit your name"
                    className="size-7 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
                  >
                    <Pencil aria-hidden className="size-3.5" />
                  </button>
                  {saved && (
                    <span className="inline-flex items-center gap-1 text-xs text-on-tint-brand">
                      <Check aria-hidden className="size-3.5" />
                      Saved
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted truncate">{email}</p>
              </>
            )}
          </div>
        </div>

        {uploading && <p className="text-xs text-muted mt-3">Uploading your photo…</p>}

        {!uploadsEnabled && (
          <p className="text-xs text-subtle mt-4 leading-relaxed">
            Photo uploads aren&rsquo;t configured for this deployment, so FamLink is showing your
            initials instead.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
