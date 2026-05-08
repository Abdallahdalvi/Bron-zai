export interface ToolDefinition {
  name: string;
  category:
    | 'observation'
    | 'interaction'
    | 'navigation'
    | 'bookmarks'
    | 'history'
    | 'tab-groups'
    | 'page-actions'
    | 'filesystem'
    | 'memory'
    | 'identity'
    | 'integration'
    | 'scheduling';
  description: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'take_snapshot', category: 'observation', description: 'Get interactive elements with IDs.' },
  { name: 'take_enhanced_snapshot', category: 'observation', description: 'Get full accessibility tree snapshot.' },
  { name: 'get_page_content', category: 'observation', description: 'Extract page content in markdown-like text.' },
  { name: 'get_page_links', category: 'observation', description: 'List links from current page.' },
  { name: 'get_dom', category: 'observation', description: 'Read raw DOM HTML.' },
  { name: 'search_dom', category: 'observation', description: 'Search DOM by text, selector, or xpath.' },
  { name: 'take_screenshot', category: 'observation', description: 'Capture screenshot.' },
  { name: 'evaluate_script', category: 'observation', description: 'Execute JavaScript in page context.' },
  { name: 'get_console_logs', category: 'observation', description: 'Read browser console logs.' },

  { name: 'click', category: 'interaction', description: 'Click element by id.' },
  { name: 'click_at', category: 'interaction', description: 'Click page coordinates.' },
  { name: 'fill', category: 'interaction', description: 'Fill input fields.' },
  { name: 'clear', category: 'interaction', description: 'Clear input fields.' },
  { name: 'select_option', category: 'interaction', description: 'Select dropdown option.' },
  { name: 'check', category: 'interaction', description: 'Check checkbox.' },
  { name: 'uncheck', category: 'interaction', description: 'Uncheck checkbox.' },
  { name: 'press_key', category: 'interaction', description: 'Send keyboard input.' },
  { name: 'hover', category: 'interaction', description: 'Hover element.' },
  { name: 'hover_at', category: 'interaction', description: 'Hover coordinates.' },
  { name: 'scroll', category: 'interaction', description: 'Scroll page or element.' },
  { name: 'drag', category: 'interaction', description: 'Drag from source to target.' },
  { name: 'drag_at', category: 'interaction', description: 'Drag from source to coordinates.' },
  { name: 'upload_file', category: 'interaction', description: 'Upload local files to file input.' },
  { name: 'focus', category: 'interaction', description: 'Focus element.' },

  { name: 'navigate_page', category: 'navigation', description: 'Navigate current page (url/back/forward/reload).' },
  { name: 'new_page', category: 'navigation', description: 'Open new page.' },
  { name: 'close_page', category: 'navigation', description: 'Close page by id.' },
  { name: 'list_pages', category: 'navigation', description: 'List open pages.' },
  { name: 'get_active_page', category: 'navigation', description: 'Get active page info.' },

  { name: 'get_bookmarks', category: 'bookmarks', description: 'List bookmarks.' },
  { name: 'create_bookmark', category: 'bookmarks', description: 'Create bookmark.' },
  { name: 'remove_bookmark', category: 'bookmarks', description: 'Remove bookmark.' },
  { name: 'update_bookmark', category: 'bookmarks', description: 'Update bookmark fields.' },
  { name: 'move_bookmark', category: 'bookmarks', description: 'Move bookmark.' },
  { name: 'search_bookmarks', category: 'bookmarks', description: 'Search bookmarks.' },

  { name: 'search_history', category: 'history', description: 'Search browser history.' },
  { name: 'get_recent_history', category: 'history', description: 'Get recent browser history.' },
  { name: 'delete_history_url', category: 'history', description: 'Delete one URL from history.' },
  { name: 'delete_history_range', category: 'history', description: 'Delete history in time range.' },

  { name: 'list_tab_groups', category: 'tab-groups', description: 'List browser tab groups.' },
  { name: 'group_tabs', category: 'tab-groups', description: 'Create or update tab group.' },
  { name: 'update_tab_group', category: 'tab-groups', description: 'Update tab group metadata.' },
  { name: 'ungroup_tabs', category: 'tab-groups', description: 'Ungroup tabs.' },
  { name: 'close_tab_group', category: 'tab-groups', description: 'Close all tabs in a group.' },

  { name: 'save_pdf', category: 'page-actions', description: 'Save active page as pdf.' },
  { name: 'save_screenshot', category: 'page-actions', description: 'Save screenshot to disk.' },
  { name: 'download_file', category: 'page-actions', description: 'Trigger a file download.' },

  { name: 'filesystem_read', category: 'filesystem', description: 'Read file contents.' },
  { name: 'filesystem_write', category: 'filesystem', description: 'Write file contents.' },
  { name: 'filesystem_edit', category: 'filesystem', description: 'Edit file with targeted replacement.' },
  { name: 'filesystem_bash', category: 'filesystem', description: 'Run shell command.' },
  { name: 'filesystem_grep', category: 'filesystem', description: 'Search file contents.' },
  { name: 'filesystem_find', category: 'filesystem', description: 'Find files by pattern.' },
  { name: 'filesystem_ls', category: 'filesystem', description: 'List directory contents.' },

  { name: 'memory_search', category: 'memory', description: 'Search CORE/SOUL/daily memory.' },
  { name: 'memory_write', category: 'memory', description: 'Write entry to daily memory.' },
  { name: 'memory_read_core', category: 'memory', description: 'Read CORE memory.' },
  { name: 'memory_update_core', category: 'memory', description: 'Update CORE memory facts.' },

  { name: 'soul_read', category: 'identity', description: 'Read SOUL profile.' },
  { name: 'soul_update', category: 'identity', description: 'Update SOUL profile.' },

  {
    name: 'discover_server_categories_or_actions',
    category: 'integration',
    description: 'Discover MCP/Strata actions for connected apps.',
  },
  {
    name: 'execute_action',
    category: 'integration',
    description: 'Execute MCP/Strata action for connected app.',
  },
  {
    name: 'search_documentation',
    category: 'integration',
    description: 'Search integration documentation.',
  },

  { name: 'suggest_schedule', category: 'scheduling', description: 'Propose recurring schedule.' },
];

export function getToolsByCategory(
  category: ToolDefinition['category'],
): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => tool.category === category);
}

export function getToolByName(name: string): ToolDefinition | undefined {
  const key = String(name || '').trim().toLowerCase();
  return TOOL_DEFINITIONS.find((tool) => tool.name.toLowerCase() === key);
}
