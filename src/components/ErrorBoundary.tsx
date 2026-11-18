// Contains a render error to one area instead of unmounting the whole app
// (an uncaught error used to leave a blank window).
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { label: string; children: ReactNode; onReset?: () => void; compact?: boolean }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Message and component stack only; never user content.
    console.error(`[${this.props.label}] ${error.message}`, info.componentStack?.split("\n").slice(0, 4).join("\n"));
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`error-boundary${this.props.compact ? " compact" : ""}`} role="alert">
        <b>Something went wrong in {this.props.label}.</b>
        <span className="faint">{this.state.error.message}</span>
        <span className="faint">Your data is safe. This part of the screen was reset so the rest keeps working.</span>
        <button className="btn small" onClick={this.reset}>Try again</button>
      </div>
    );
  }
}
