import { Component } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { reloadWithFreshBuild } from '../offline/updateGuard';

// Catches render/lifecycle errors anywhere below it so a single bad page
// never leaves the user staring at a blank screen. `resetKey` (normally the
// current pathname) clears the error on navigation, so going "back" works.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, stack: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    this.setState({ stack: [error?.stack, info?.componentStack].filter(Boolean).join('\n') });
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, stack: null });
    }
  }

  // Clears the stale service-worker precache so the reload cannot bring
  // back the same broken asset mix.
  handleReload = () => reloadWithFreshBuild();

  handleHome = () => {
    window.location.href = '/courses';
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#0A1628]">
        <div className="card max-w-md w-full text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
            <AlertTriangle size={26} className="text-red-400" />
          </div>
          <h1 className="font-display font-bold text-xl text-white mb-2">
            This page failed to load
          </h1>
          <p className="text-gray-400 text-sm mb-4">
            Something went wrong while rendering. Reloading usually fixes it.
          </p>
          <p className="text-xs text-gray-600 bg-black/20 rounded-lg p-3 mb-5 font-mono break-words max-h-24 overflow-y-auto text-left">
            {String(error?.message || error)}
          </p>
          {this.state.stack && (
            <details className="text-left mb-4">
              <summary className="text-xs text-gray-500 cursor-pointer select-none">
                Technical details
              </summary>
              <pre className="text-[10px] text-gray-500 bg-black/20 rounded-lg p-3 mt-2 overflow-auto max-h-40 whitespace-pre-wrap break-words">
                {this.state.stack}
              </pre>
            </details>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button onClick={this.handleReload}
              className="btn-primary text-sm px-4 py-2 flex items-center justify-center gap-2">
              <RefreshCw size={15} /> Reload
            </button>
            <button onClick={this.handleHome}
              className="btn-ghost text-sm px-4 py-2 flex items-center justify-center gap-2">
              <Home size={15} /> Course Catalog
            </button>
          </div>
        </div>
      </div>
    );
  }
}