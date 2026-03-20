/**
 * Simple API client functions — currently have no error handling.
 */

export async function fetchUser(id: string): Promise<{ name: string; email: string }> {
  const response = await fetch(`https://api.example.com/users/${id}`);
  const data = await response.json();
  return { name: data.name, email: data.email };
}

export async function fetchPosts(userId: string): Promise<{ title: string; body: string }[]> {
  const response = await fetch(`https://api.example.com/users/${userId}/posts`);
  const data = await response.json();
  return data.posts.map((p: any) => ({ title: p.title, body: p.body }));
}

export async function createPost(userId: string, title: string, body: string): Promise<string> {
  const response = await fetch(`https://api.example.com/users/${userId}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  const data = await response.json();
  return data.id;
}
