#!/bin/bash

# LobeHub K8S Deployment Management Script
set -e

NAMESPACE="lobehub"
K8S_DIR="$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check cluster connection
check_cluster() {
    if ! kubectl cluster-info >/dev/null 2>&1; then
        print_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    print_status "Connected to Kubernetes cluster"
}

# Function to check prerequisites
check_prerequisites() {
    if ! command_exists kubectl; then
        print_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    check_cluster
}

# Function to show menu
show_menu() {
    echo ""
    print_header "LobeHub Kubernetes Management"
    echo "1. Deploy LobeHub stack"
    echo "2. Clean up LobeHub stack"
    echo "3. Check deployment status"
    echo "4. Show service URLs"
    echo "5. View logs"
    echo "0. Exit"
    echo ""
    read -p "Please select an option (0-5): " choice
}

# Function to deploy stack
deploy_stack() {
    print_header "Deploying LobeHub Stack"

    # Create namespace first
    print_status "Creating namespace..."
    kubectl apply -f "$K8S_DIR/components/00-namespace.yaml"

    # Apply all components in order
    print_status "Applying persistent volume claims..."
    kubectl apply -f "$K8S_DIR/components/01-persistent-volumes.yaml"

    print_status "Applying secrets..."
    kubectl apply -f "$K8S_DIR/components/02-secrets.yaml"

    print_status "Deploying database services..."
    kubectl apply -f "$K8S_DIR/components/03-postgres.yaml"
    kubectl apply -f "$K8S_DIR/components/04-redis.yaml"

    print_status "Deploying storage services..."
    kubectl apply -f "$K8S_DIR/components/05-rustfs.yaml"
    kubectl apply -f "$K8S_DIR/components/06-searxng.yaml"

    print_status "Deploying application..."
    kubectl apply -f "$K8S_DIR/components/07-lobehub.yaml"

    # Optional: Apply ingress if ingress controller is available
    read -p "Do you want to apply Ingress configuration for external access? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Applying ingress configuration..."
        kubectl apply -f "$K8S_DIR/components/08-ingress.yaml"
    fi

    # Wait for pods to be ready
    print_status "Waiting for pods to be ready..."
    if ! kubectl wait --for=condition=ready pod -l tier=database -n $NAMESPACE --timeout=300s; then
        print_warning "Database pods not ready within timeout"
    fi
    if ! kubectl wait --for=condition=ready pod -l tier=cache -n $NAMESPACE --timeout=300s; then
        print_warning "Cache pods not ready within timeout"
    fi
    if ! kubectl wait --for=condition=ready pod -l tier=storage -n $NAMESPACE --timeout=300s; then
        print_warning "Storage pods not ready within timeout"
    fi
    if ! kubectl wait --for=condition=ready pod -l tier=search -n $NAMESPACE --timeout=300s; then
        print_warning "Search pods not ready within timeout"
    fi
    if ! kubectl wait --for=condition=ready pod -l tier=frontend -n $NAMESPACE --timeout=300s; then
        print_warning "Frontend pods not ready within timeout"
    fi

    print_status "Deployment completed!"
    show_service_urls
}

# Function to cleanup stack
cleanup_stack() {
    print_header "Cleaning up LobeHub Stack"

    # Check if namespace exists
    if ! kubectl get namespace $NAMESPACE >/dev/null 2>&1; then
        print_warning "Namespace $NAMESPACE does not exist"
        return
    fi

    # Show current resources
    print_status "Current resources in $NAMESPACE:"
    kubectl get all -n $NAMESPACE 2>/dev/null || print_warning "No resources found"

    # Ask for confirmation
    echo ""
    print_warning "This will delete the entire '$NAMESPACE' namespace and ALL data!"
    print_warning "PersistentVolumeClaims will be deleted, underlying PersistentVolumes may remain depending on reclaim policy."
    echo ""
    read -p "Type 'DELETE' to confirm cleanup: " -r
    echo
    if [[ $REPLY != "DELETE" ]]; then
        print_status "Cleanup cancelled"
        return
    fi

    print_status "Deleting namespace and all resources..."
    kubectl delete namespace $NAMESPACE

    # Wait for namespace to be deleted
    print_status "Waiting for namespace deletion to complete..."
    while kubectl get namespace $NAMESPACE >/dev/null 2>&1; do
        echo -n "."
        sleep 2
    done
    echo ""
    print_status "Namespace $NAMESPACE deleted successfully!"

    # Check for remaining PVs
    echo ""
    print_status "Checking for remaining PersistentVolumes..."
    remaining_pvs=$(kubectl get pv 2>/dev/null --no-headers | wc -l)
    if [ "$remaining_pvs" -gt 0 ]; then
        print_warning "Found $remaining_pvs PersistentVolume(s) that may need manual cleanup:"
        kubectl get pv
        echo ""
        print_status "To clean up remaining PVs, use: kubectl delete pv <pv-name>"
    else
        print_status "No remaining PersistentVolumes found"
    fi
}

# Function to check deployment status
check_status() {
    print_header "Deployment Status"

    if ! kubectl get namespace $NAMESPACE >/dev/null 2>&1; then
        print_warning "Namespace $NAMESPACE does not exist"
        return
    fi

    echo ""
    print_status "Pods:"
    kubectl get pods -n $NAMESPACE -o wide

    echo ""
    print_status "Services:"
    kubectl get services -n $NAMESPACE

    echo ""
    print_status "Persistent Volume Claims:"
    kubectl get pvc -n $NAMESPACE

    echo ""
    print_status "Recent Events:"
    kubectl get events -n $NAMESPACE --sort-by='.lastTimestamp' | tail -10
}

# Function to show service URLs
show_service_urls() {
    print_header "Service Access Information"

    if ! kubectl get namespace $NAMESPACE >/dev/null 2>&1; then
        print_warning "Namespace $NAMESPACE does not exist"
        return
    fi

    print_status "LobeHub is available at:"
    echo "  - Port-forward: kubectl port-forward -n $NAMESPACE svc/lobehub 3210:3210"
    echo "  - Local access: http://localhost:3210"

    echo ""
    print_status "Other services (for debugging):"
    echo "  - Redis: kubectl port-forward -n $NAMESPACE svc/redis 6379:6379"
    echo "  - PostgreSQL: kubectl port-forward -n $NAMESPACE svc/postgres 5432:5432"
    echo "  - SearXNG: kubectl port-forward -n $NAMESPACE svc/searxng 8080:8080"
    echo "  - Rustfs: kubectl port-forward -n $NAMESPACE svc/rustfs 9000:9000"

    # Check if ingress was applied
    if kubectl get ingress lobehub-ingress -n $NAMESPACE >/dev/null 2>&1; then
        echo ""
        print_status "Ingress URLs (if DNS is configured):"
        echo "  - LobeHub: http://lobehub.local"
        echo "  - SearXNG: http://searxng.local"
    fi
}

# Function to view logs
view_logs() {
    print_header "View Logs"

    if ! kubectl get namespace $NAMESPACE >/dev/null 2>&1; then
        print_warning "Namespace $NAMESPACE does not exist"
        return
    fi

    echo "Select a service to view logs:"
    echo "1. LobeHub"
    echo "2. PostgreSQL"
    echo "3. Redis"
    echo "4. Rustfs"
    echo "5. SearXNG"
    read -p "Enter your choice (1-5): " choice

    case $choice in
        1)
            kubectl logs -l app=lobehub -n $NAMESPACE -f
            ;;
        2)
            kubectl logs -l app=postgres -n $NAMESPACE -f
            ;;
        3)
            kubectl logs -l app=redis -n $NAMESPACE -f
            ;;
        4)
            kubectl logs -l app=rustfs -n $NAMESPACE -f
            ;;
        5)
            kubectl logs -l app=searxng -n $NAMESPACE -f
            ;;
        *)
            print_error "Invalid choice"
            ;;
    esac
}

# Function to handle command line arguments
handle_args() {
    case "$1" in
        deploy)
            deploy_stack
            ;;
        cleanup)
            cleanup_stack
            ;;
        status)
            check_status
            ;;
        urls)
            show_service_urls
            ;;
        logs)
            view_logs
            ;;
        *)
            print_status "Usage: $0 {deploy|cleanup|status|urls|logs}"
            exit 1
            ;;
    esac
}

# Main execution
main() {
    check_prerequisites

    # Handle command line arguments if provided
    if [ $# -eq 1 ]; then
        handle_args "$1"
        exit 0
    fi

    # Interactive menu
    while true; do
        show_menu
        case $choice in
            1)
                deploy_stack
                ;;
            2)
                cleanup_stack
                ;;
            3)
                check_status
                ;;
            4)
                show_service_urls
                ;;
            5)
                view_logs
                ;;
            0)
                print_status "Goodbye!"
                exit 0
                ;;
            *)
                print_error "Invalid choice"
                ;;
        esac

        echo ""
        read -p "Press Enter to continue..." -r
    done
}

# Run main function with all arguments
main "$@"
