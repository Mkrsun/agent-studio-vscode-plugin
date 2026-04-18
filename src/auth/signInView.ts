import * as vscode from 'vscode';
import { AuthService } from './authService';
import { AuthState } from './authTypes';
import { COMMANDS, VIEW_IDS } from '../constants';

/**
 * TreeDataProvider shown in both sidebar views before the user is authenticated.
 * Displays a single actionable "Sign in with GitHub" entry whose label / tooltip
 * reflects the current AuthState (unauthenticated / authenticating / denied).
 */
class SignInTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly authService: AuthService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const state: AuthState = this.authService.currentState;
    const deny = this.authService.getDenyReason();

    if (state === 'authenticating') {
      const item = new vscode.TreeItem('Signing in…');
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      return [item];
    }

    const item = new vscode.TreeItem('Sign in with GitHub');
    item.iconPath = new vscode.ThemeIcon('sign-in');
    item.command = {
      command: COMMANDS.SIGN_IN,
      title: 'Sign In with GitHub',
    };

    if (state === 'denied' && deny) {
      item.description = 'Access denied';
      item.tooltip = new vscode.MarkdownString(
        `**Access denied**\n\n${deny.message}\n\n*Click to try again.*`,
      );
    } else {
      item.description = 'Required to use Agent Studio';
      item.tooltip = new vscode.MarkdownString(
        '**Agent Studio requires GitHub authentication.**\n\n' +
          'You must be an active member of an authorized MetLife GitHub organization.\n\n' +
          '*Click to sign in.*',
      );
    }
    return [item];
  }
}

/**
 * Register both sidebar views with the sign-in placeholder. Returns the
 * disposables so `extension.ts` can tear them down once auth succeeds.
 */
export function registerSignInViews(authService: AuthService): vscode.Disposable[] {
  const provider = new SignInTreeProvider(authService);

  const library = vscode.window.createTreeView(VIEW_IDS.ASSET_LIBRARY, {
    treeDataProvider: provider,
  });
  const workflows = vscode.window.createTreeView(VIEW_IDS.ACTIVE_WORKFLOWS, {
    treeDataProvider: provider,
  });

  const stateListener = authService.onDidChangeAuthState(() => provider.refresh());

  return [library, workflows, stateListener];
}
