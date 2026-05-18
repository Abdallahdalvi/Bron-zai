import sys
import json

class Controller:
    """
    Registry controller replicating the browser-use Python decorator architecture.
    """
    def __init__(self):
        self.actions = {}

    def action(self, description):
        def decorator(func):
            self.actions[func.__name__] = {
                "func": func,
                "description": description
            }
            return func
        return decorator

controller = Controller()

def call_browser(action, target="", value=""):
    """
    Send browser actions to Electron's active browser controller (bc) over stdin/stdout.
    """
    req = {
        "action": action,
        "target": target,
        "value": value
    }
    # Output JSON-RPC request to stdout
    print(f"__BRON_BROWSER_REQ__:{json.dumps(req)}", flush=True)
    
    # Read browser execution result from Electron over stdin
    line = sys.stdin.readline().strip()
    try:
        res = json.loads(line)
        return res.get("result")
    except Exception as e:
        return f"Error parsing browser response: {str(e)}"

# Register a custom python action matching browser-use decorators!
@controller.action("Automate a dynamic search via Google using Bron browser controller")
def python_search_action(query):
    print(f"[Python Tool] Starting search for: {query}", flush=True)
    
    # 1. Navigate to Google
    nav_res = call_browser("navigate_page", "https://www.google.com")
    print(f"[Python Tool] Navigation result: {nav_res}", flush=True)
    
    # 2. Fill query in input field
    fill_res = call_browser("fill", "textarea[name='q']", query)
    print(f"[Python Tool] Fill result: {fill_res}", flush=True)
    
    # 3. Submit query
    submit_res = call_browser("press_enter")
    print(f"[Python Tool] Submit result: {submit_res}", flush=True)
    
    return f"Success! Python custom decorator task completed for query: '{query}'"

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--metadata":
        # Print registered action metadata
        metadata = {}
        for name, meta in controller.actions.items():
            metadata[name] = {
                "description": meta["description"]
            }
        print(json.dumps(metadata))
        sys.exit(0)

    # Execute custom action
    if len(sys.argv) > 2:
        action_name = sys.argv[1]
        try:
            raw_args = json.loads(sys.argv[2])
        except:
            raw_args = sys.argv[2]

        # Normalize single-argument arrays from Electron
        if isinstance(raw_args, list) and len(raw_args) == 1:
            raw_args = raw_args[0]

        # Dynamic function invocation
        func_entry = controller.actions.get("python_search_action") # Default to google search action
        if func_entry:
            func = func_entry["func"]
            try:
                res = func(raw_args)
                # Return successful JSON-RPC payload back to Electron
                print(f"__BRON_PYTHON_RES__:{json.dumps({'status': 'success', 'result': res})}", flush=True)
            except Exception as e:
                print(f"__BRON_PYTHON_RES__:{json.dumps({'status': 'error', 'message': str(e)})}", flush=True)
        else:
            print(f"__BRON_PYTHON_RES__:{json.dumps({'status': 'error', 'message': f'Action {action_name} not found'})}", flush=True)
    else:
        print("[Python Tool] Usage: python index.py <action_name> <json_args>", file=sys.stderr)
        sys.exit(1)
