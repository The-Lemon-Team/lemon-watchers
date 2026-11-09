import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseService } from '../dist/db/database.service.js';
import dotenv from 'dotenv';

dotenv.config();

describe('Folders and Dynamic Watchers DB API', () => {
  let db;

  beforeAll(async () => {
    db = new DatabaseService(process.env.DATABASE_URL);
    await db.initSchema();
  });

  afterAll(async () => {
    await db.close();
  });

  it('initializes default system folders', async () => {
    const folders = await db.getFolders();
    expect(folders.length).toBeGreaterThanOrEqual(5);

    const slugs = folders.map((f) => f.slug);
    expect(slugs).toContain('ai');
    expect(slugs).toContain('cybersec');
    expect(slugs).toContain('habr');
    expect(slugs).toContain('politics');
    expect(slugs).toContain('frontier');
  });

  it('creates and deletes custom folders', async () => {
    const created = await db.createFolder({
      title: 'Тестовая папка Web3',
      icon: '💎',
      color: '#8b5cf6',
      description: 'Папка для тестов',
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe('Тестовая папка Web3');
    expect(created.isSystem).toBe(false);

    // Verify it appears in folders list
    const list = await db.getFolders();
    const found = list.find((f) => f.id === created.id);
    expect(found).toBeDefined();

    // Delete custom folder
    const deleted = await db.deleteFolder(created.id);
    expect(deleted).toBe(true);

    // Verify deleted
    const listAfter = await db.getFolders();
    expect(listAfter.find((f) => f.id === created.id)).toBeUndefined();
  });

  it('cannot delete system folders', async () => {
    const deleted = await db.deleteFolder('ai');
    expect(deleted).toBe(false);
  });
});
