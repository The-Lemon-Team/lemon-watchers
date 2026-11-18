import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';

@ApiTags('Folders')
@Controller('api/v1/folders')
export class FoldersController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all watcher folders' })
  async getFolders() {
    const folders = await this.engine.getFolders();
    return { total: folders.length, items: folders };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom folder' })
  async createFolder(@Body() body: any) {
    if (!body?.title) {
      throw new BadRequestException('Folder title is required');
    }
    return this.engine.createFolder(body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom folder by ID or slug' })
  async deleteFolder(@Param('id') id: string) {
    const success = await this.engine.deleteFolder(id);
    if (!success) {
      throw new NotFoundException(
        `Folder not found or is a protected system folder: ${id}`
      );
    }
    return { message: 'Folder deleted successfully' };
  }
}
